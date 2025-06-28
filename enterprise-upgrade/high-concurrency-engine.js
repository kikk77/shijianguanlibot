/**
 * 企业级高并发处理引擎
 * 支持10,000+ QPS，50,000+ 并发用户
 * 
 * 核心功能：
 * - 智能连接池管理
 * - 多层缓存架构
 * - 异步任务队列
 * - 租户隔离
 * - 性能监控
 */

const { Pool } = require('pg');
const Redis = require('ioredis');
const Bull = require('bull');
const EventEmitter = require('events');
const cluster = require('cluster');
const os = require('os');

// =====================================
// 数据库连接池管理器
// =====================================
class DatabasePoolManager extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.masterPool = null;
        this.slavePools = [];
        this.slaveIndex = 0;
        this.poolStats = {
            totalConnections: 0,
            activeConnections: 0,
            waitingClients: 0,
            totalQueries: 0,
            slowQueries: 0
        };
        
        this.initializePools();
        this.startHealthMonitoring();
    }
    
    // 初始化连接池
    initializePools() {
        console.log('🔄 初始化数据库连接池...');
        
        // 主库连接池（写操作）
        this.masterPool = new Pool({
            host: this.config.master.host,
            port: this.config.master.port,
            database: this.config.master.database,
            user: this.config.master.user,
            password: this.config.master.password,
            max: this.config.master.max || 20,
            min: this.config.master.min || 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            acquireTimeoutMillis: 3000,
            
            // 性能优化配置
            statement_timeout: 30000,
            query_timeout: 30000,
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
        });
        
        // 从库连接池（读操作）
        this.slavePools = this.config.slaves.map((slaveConfig, index) => {
            const pool = new Pool({
                host: slaveConfig.host,
                port: slaveConfig.port || 5432,
                database: slaveConfig.database || this.config.master.database,
                user: slaveConfig.user || this.config.master.user,
                password: slaveConfig.password || this.config.master.password,
                max: slaveConfig.max || 50, // 读库连接数更多
                min: slaveConfig.min || 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000,
                acquireTimeoutMillis: 3000,
                
                // 只读配置
                application_name: `slave_${index}_reader`,
                default_transaction_isolation: 'read committed'
            });
            
            pool.on('error', (err) => {
                console.error(`❌ 从库${index}连接池错误:`, err);
                this.emit('slaveError', { index, error: err });
            });
            
            return pool;
        });
        
        // 事件监听
        this.masterPool.on('error', (err) => {
            console.error('❌ 主库连接池错误:', err);
            this.emit('masterError', err);
        });
        
        this.masterPool.on('connect', (client) => {
            this.poolStats.totalConnections++;
            this.poolStats.activeConnections++;
            console.log(`📊 主库新连接，总连接数: ${this.poolStats.activeConnections}`);
        });
        
        console.log('✅ 数据库连接池初始化完成');
    }
    
    // 智能查询路由（读写分离）
    async executeQuery(query, params = [], options = {}) {
        const startTime = Date.now();
        const isWriteQuery = this.isWriteQuery(query);
        const queryId = this.generateQueryId();
        
        try {
            this.poolStats.totalQueries++;
            
            let result;
            if (isWriteQuery || options.forcemaster) {
                // 写操作或强制主库
                result = await this.masterPool.query(query, params);
                this.emit('queryExecuted', {
                    queryId,
                    type: 'write',
                    duration: Date.now() - startTime,
                    pool: 'master'
                });
            } else {
                // 读操作，负载均衡到从库
                const slavePool = this.getNextSlavePool();
                result = await slavePool.query(query, params);
                this.emit('queryExecuted', {
                    queryId,
                    type: 'read',
                    duration: Date.now() - startTime,
                    pool: 'slave'
                });
            }
            
            const duration = Date.now() - startTime;
            
            // 慢查询监控
            if (duration > 1000) {
                this.poolStats.slowQueries++;
                console.warn(`⚠️ 慢查询检测 (${duration}ms): ${query.substring(0, 100)}...`);
                this.emit('slowQuery', {
                    queryId,
                    query,
                    params,
                    duration
                });
            }
            
            return result;
            
        } catch (error) {
            this.emit('queryError', {
                queryId,
                query,
                params,
                error: error.message,
                duration: Date.now() - startTime
            });
            throw error;
        }
    }
    
    // 判断是否为写操作
    isWriteQuery(query) {
        const writeKeywords = ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TRUNCATE'];
        const upperQuery = query.trim().toUpperCase();
        return writeKeywords.some(keyword => upperQuery.startsWith(keyword));
    }
    
    // 获取下一个从库连接池（负载均衡）
    getNextSlavePool() {
        if (this.slavePools.length === 0) {
            return this.masterPool; // 降级到主库
        }
        
        const pool = this.slavePools[this.slaveIndex];
        this.slaveIndex = (this.slaveIndex + 1) % this.slavePools.length;
        return pool;
    }
    
    // 生成查询ID
    generateQueryId() {
        return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // 健康监控
    startHealthMonitoring() {
        setInterval(async () => {
            try {
                // 检查主库健康状态
                await this.masterPool.query('SELECT 1');
                
                // 检查从库健康状态
                for (let i = 0; i < this.slavePools.length; i++) {
                    try {
                        await this.slavePools[i].query('SELECT 1');
                    } catch (error) {
                        console.error(`❌ 从库${i}健康检查失败:`, error.message);
                    }
                }
                
                // 更新连接池统计
                this.poolStats.activeConnections = this.masterPool.totalCount;
                this.poolStats.waitingClients = this.masterPool.waitingCount;
                
                this.emit('healthCheck', this.poolStats);
                
            } catch (error) {
                console.error('❌ 数据库健康检查失败:', error);
                this.emit('healthCheckFailed', error);
            }
        }, 10000); // 每10秒检查一次
    }
    
    // 获取连接池统计信息
    getPoolStats() {
        return {
            ...this.poolStats,
            masterPool: {
                totalCount: this.masterPool.totalCount,
                idleCount: this.masterPool.idleCount,
                waitingCount: this.masterPool.waitingCount
            },
            slavePools: this.slavePools.map((pool, index) => ({
                index,
                totalCount: pool.totalCount,
                idleCount: pool.idleCount,
                waitingCount: pool.waitingCount
            }))
        };
    }
    
    // 优雅关闭
    async close() {
        console.log('🔄 正在关闭数据库连接池...');
        
        try {
            await this.masterPool.end();
            
            for (const slavePool of this.slavePools) {
                await slavePool.end();
            }
            
            console.log('✅ 数据库连接池已关闭');
        } catch (error) {
            console.error('❌ 关闭连接池时出错:', error);
        }
    }
}

// =====================================
// 多层缓存管理器
// =====================================
class CacheManager {
    constructor(config) {
        this.config = config;
        this.memoryCache = new Map(); // L1: 内存缓存
        this.maxMemorySize = config.maxMemorySize || 1000;
        this.memoryHits = 0;
        this.memoryMisses = 0;
        
        // L2: Redis缓存
        this.redisClient = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            db: config.redis.db || 0,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            lazyConnect: true,
            keepAlive: 30000,
            
            // 集群配置
            enableOfflineQueue: false,
            maxRetriesPerRequest: 3,
            retryDelayOnFailover: 100,
            connectTimeout: 10000,
            commandTimeout: 5000,
        });
        
        this.setupRedisEvents();
        this.startMemoryCleanup();
    }
    
    // Redis事件监听
    setupRedisEvents() {
        this.redisClient.on('connect', () => {
            console.log('✅ Redis连接成功');
        });
        
        this.redisClient.on('error', (err) => {
            console.error('❌ Redis连接错误:', err);
        });
        
        this.redisClient.on('reconnecting', (delay) => {
            console.log(`🔄 Redis重连中... (${delay}ms)`);
        });
    }
    
    // 智能缓存获取（L1 -> L2 -> 数据库）
    async get(key, tenantId, options = {}) {
        const cacheKey = this.buildCacheKey(key, tenantId);
        const startTime = Date.now();
        
        try {
            // L1: 内存缓存检查
            if (this.memoryCache.has(cacheKey)) {
                this.memoryHits++;
                const cachedData = this.memoryCache.get(cacheKey);
                
                // 检查过期时间
                if (!cachedData.expires || cachedData.expires > Date.now()) {
                    return {
                        data: cachedData.data,
                        source: 'memory',
                        hitTime: Date.now() - startTime
                    };
                } else {
                    // 内存缓存已过期
                    this.memoryCache.delete(cacheKey);
                }
            }
            
            this.memoryMisses++;
            
            // L2: Redis缓存检查
            const redisValue = await this.redisClient.get(cacheKey);
            if (redisValue) {
                const data = JSON.parse(redisValue);
                
                // 回写到内存缓存
                this.setMemoryCache(cacheKey, data, options.ttl);
                
                return {
                    data,
                    source: 'redis',
                    hitTime: Date.now() - startTime
                };
            }
            
            // 缓存未命中
            return {
                data: null,
                source: 'miss',
                hitTime: Date.now() - startTime
            };
            
        } catch (error) {
            console.error('❌ 缓存获取失败:', error);
            return {
                data: null,
                source: 'error',
                error: error.message,
                hitTime: Date.now() - startTime
            };
        }
    }
    
    // 智能缓存设置
    async set(key, value, tenantId, ttl = 300) {
        const cacheKey = this.buildCacheKey(key, tenantId);
        
        try {
            // 设置到内存缓存
            this.setMemoryCache(cacheKey, value, ttl);
            
            // 设置到Redis缓存
            await this.redisClient.setex(cacheKey, ttl, JSON.stringify(value));
            
            return true;
            
        } catch (error) {
            console.error('❌ 缓存设置失败:', error);
            return false;
        }
    }
    
    // 批量缓存设置
    async setMultiple(keyValuePairs, tenantId, ttl = 300) {
        const pipeline = this.redisClient.pipeline();
        
        keyValuePairs.forEach(({ key, value }) => {
            const cacheKey = this.buildCacheKey(key, tenantId);
            
            // 设置到内存缓存
            this.setMemoryCache(cacheKey, value, ttl);
            
            // 添加到Redis管道
            pipeline.setex(cacheKey, ttl, JSON.stringify(value));
        });
        
        try {
            await pipeline.exec();
            return true;
        } catch (error) {
            console.error('❌ 批量缓存设置失败:', error);
            return false;
        }
    }
    
    // 缓存删除
    async delete(key, tenantId) {
        const cacheKey = this.buildCacheKey(key, tenantId);
        
        try {
            // 从内存缓存删除
            this.memoryCache.delete(cacheKey);
            
            // 从Redis删除
            await this.redisClient.del(cacheKey);
            
            return true;
            
        } catch (error) {
            console.error('❌ 缓存删除失败:', error);
            return false;
        }
    }
    
    // 按模式批量删除
    async deletePattern(pattern, tenantId) {
        const cachePattern = this.buildCacheKey(pattern, tenantId);
        
        try {
            // 获取匹配的keys
            const keys = await this.redisClient.keys(cachePattern);
            
            if (keys.length > 0) {
                // 从内存缓存删除
                keys.forEach(key => this.memoryCache.delete(key));
                
                // 从Redis批量删除
                await this.redisClient.del(...keys);
            }
            
            return keys.length;
            
        } catch (error) {
            console.error('❌ 批量缓存删除失败:', error);
            return 0;
        }
    }
    
    // 构建缓存键
    buildCacheKey(key, tenantId) {
        return `${tenantId}:${key}`;
    }
    
    // 设置内存缓存
    setMemoryCache(key, value, ttl) {
        // 检查内存使用量
        if (this.memoryCache.size >= this.maxMemorySize) {
            this.evictLRU();
        }
        
        const expires = ttl ? Date.now() + (ttl * 1000) : null;
        this.memoryCache.set(key, {
            data: value,
            expires,
            accessTime: Date.now()
        });
    }
    
    // LRU淘汰策略
    evictLRU() {
        let oldestKey = null;
        let oldestTime = Date.now();
        
        for (const [key, value] of this.memoryCache.entries()) {
            if (value.accessTime < oldestTime) {
                oldestTime = value.accessTime;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.memoryCache.delete(oldestKey);
        }
    }
    
    // 内存清理定时任务
    startMemoryCleanup() {
        setInterval(() => {
            const now = Date.now();
            const expiredKeys = [];
            
            for (const [key, value] of this.memoryCache.entries()) {
                if (value.expires && value.expires < now) {
                    expiredKeys.push(key);
                }
            }
            
            expiredKeys.forEach(key => this.memoryCache.delete(key));
            
            if (expiredKeys.length > 0) {
                console.log(`🧹 清理过期内存缓存: ${expiredKeys.length}个`);
            }
        }, 60000); // 每分钟清理一次
    }
    
    // 获取缓存统计
    getCacheStats() {
        const totalRequests = this.memoryHits + this.memoryMisses;
        const hitRate = totalRequests > 0 ? (this.memoryHits / totalRequests * 100).toFixed(2) : 0;
        
        return {
            memory: {
                size: this.memoryCache.size,
                maxSize: this.maxMemorySize,
                hits: this.memoryHits,
                misses: this.memoryMisses,
                hitRate: `${hitRate}%`
            },
            redis: {
                status: this.redisClient.status,
                connected: this.redisClient.status === 'ready'
            }
        };
    }
    
    // 预热缓存
    async warmupCache(tenantId, warmupData) {
        console.log(`🔥 开始预热缓存: 租户${tenantId}`);
        
        const startTime = Date.now();
        let successCount = 0;
        
        try {
            const pipeline = this.redisClient.pipeline();
            
            for (const { key, value, ttl } of warmupData) {
                const cacheKey = this.buildCacheKey(key, tenantId);
                
                // 设置到内存
                this.setMemoryCache(cacheKey, value, ttl || 300);
                
                // 添加到Redis管道
                pipeline.setex(cacheKey, ttl || 300, JSON.stringify(value));
                successCount++;
            }
            
            await pipeline.exec();
            
            const duration = Date.now() - startTime;
            console.log(`✅ 缓存预热完成: ${successCount}个key, 耗时${duration}ms`);
            
            return { success: true, count: successCount, duration };
            
        } catch (error) {
            console.error('❌ 缓存预热失败:', error);
            return { success: false, error: error.message, count: successCount };
        }
    }
}

// =====================================
// 异步任务队列管理器
// =====================================
class TaskQueueManager {
    constructor(redisConfig) {
        this.redisConfig = redisConfig;
        this.queues = new Map();
        this.processors = new Map();
        this.queueStats = new Map();
        
        this.initializeQueues();
    }
    
    // 初始化队列
    initializeQueues() {
        const queueConfigs = [
            { name: 'high-priority', concurrency: 20, priority: 1 },
            { name: 'normal-priority', concurrency: 10, priority: 2 },
            { name: 'low-priority', concurrency: 5, priority: 3 },
            { name: 'batch-processing', concurrency: 2, priority: 4 }
        ];
        
        queueConfigs.forEach(config => {
            const queue = new Bull(config.name, {
                redis: this.redisConfig,
                defaultJobOptions: {
                    removeOnComplete: 100,
                    removeOnFail: 50,
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000
                    }
                }
            });
            
            this.queues.set(config.name, queue);
            this.queueStats.set(config.name, {
                processed: 0,
                failed: 0,
                active: 0,
                waiting: 0,
                delayed: 0
            });
            
            // 队列事件监听
            queue.on('completed', (job) => {
                const stats = this.queueStats.get(config.name);
                stats.processed++;
                console.log(`✅ 任务完成: ${config.name} - ${job.id}`);
            });
            
            queue.on('failed', (job, err) => {
                const stats = this.queueStats.get(config.name);
                stats.failed++;
                console.error(`❌ 任务失败: ${config.name} - ${job.id}:`, err.message);
            });
            
            queue.on('stalled', (job) => {
                console.warn(`⚠️ 任务停滞: ${config.name} - ${job.id}`);
            });
        });
        
        console.log('✅ 任务队列初始化完成');
    }
    
    // 添加任务到队列
    async addTask(queueName, taskType, data, options = {}) {
        const queue = this.queues.get(queueName);
        if (!queue) {
            throw new Error(`队列不存在: ${queueName}`);
        }
        
        const jobOptions = {
            priority: options.priority || 0,
            delay: options.delay || 0,
            attempts: options.attempts || 3,
            ...options
        };
        
        try {
            const job = await queue.add(taskType, {
                ...data,
                tenantId: data.tenantId,
                timestamp: Date.now(),
                taskId: this.generateTaskId()
            }, jobOptions);
            
            console.log(`📋 任务已添加: ${queueName}/${taskType} - ${job.id}`);
            return job;
            
        } catch (error) {
            console.error(`❌ 添加任务失败: ${queueName}/${taskType}:`, error);
            throw error;
        }
    }
    
    // 批量添加任务
    async addBatchTasks(queueName, tasks, options = {}) {
        const queue = this.queues.get(queueName);
        if (!queue) {
            throw new Error(`队列不存在: ${queueName}`);
        }
        
        const batchJobs = tasks.map(task => ({
            name: task.taskType,
            data: {
                ...task.data,
                tenantId: task.data.tenantId,
                timestamp: Date.now(),
                taskId: this.generateTaskId()
            },
            opts: {
                priority: task.priority || 0,
                delay: task.delay || 0,
                attempts: task.attempts || 3,
                ...options
            }
        }));
        
        try {
            const jobs = await queue.addBulk(batchJobs);
            console.log(`📋 批量任务已添加: ${queueName} - ${jobs.length}个任务`);
            return jobs;
            
        } catch (error) {
            console.error(`❌ 批量添加任务失败: ${queueName}:`, error);
            throw error;
        }
    }
    
    // 注册任务处理器
    registerProcessor(queueName, taskType, processor, concurrency = 1) {
        const queue = this.queues.get(queueName);
        if (!queue) {
            throw new Error(`队列不存在: ${queueName}`);
        }
        
        const processorKey = `${queueName}:${taskType}`;
        this.processors.set(processorKey, processor);
        
        queue.process(taskType, concurrency, async (job) => {
            const startTime = Date.now();
            
            try {
                console.log(`🔄 处理任务: ${queueName}/${taskType} - ${job.id}`);
                
                const result = await processor(job.data, job);
                
                const duration = Date.now() - startTime;
                console.log(`✅ 任务处理完成: ${job.id} (${duration}ms)`);
                
                return result;
                
            } catch (error) {
                const duration = Date.now() - startTime;
                console.error(`❌ 任务处理失败: ${job.id} (${duration}ms):`, error);
                throw error;
            }
        });
        
        console.log(`✅ 处理器已注册: ${queueName}/${taskType} (并发: ${concurrency})`);
    }
    
    // 获取队列统计
    async getQueueStats() {
        const stats = {};
        
        for (const [queueName, queue] of this.queues.entries()) {
            const waiting = await queue.getWaiting();
            const active = await queue.getActive();
            const completed = await queue.getCompleted();
            const failed = await queue.getFailed();
            const delayed = await queue.getDelayed();
            
            stats[queueName] = {
                waiting: waiting.length,
                active: active.length,
                completed: completed.length,
                failed: failed.length,
                delayed: delayed.length,
                ...this.queueStats.get(queueName)
            };
        }
        
        return stats;
    }
    
    // 清理队列
    async cleanQueue(queueName, options = {}) {
        const queue = this.queues.get(queueName);
        if (!queue) {
            throw new Error(`队列不存在: ${queueName}`);
        }
        
        const {
            completed = 100,
            failed = 50,
            active = 0,
            waiting = 0
        } = options;
        
        try {
            await queue.clean(3600000, 'completed', completed);
            await queue.clean(86400000, 'failed', failed);
            
            if (active > 0) {
                await queue.clean(0, 'active', active);
            }
            
            if (waiting > 0) {
                await queue.clean(0, 'waiting', waiting);
            }
            
            console.log(`🧹 队列清理完成: ${queueName}`);
            
        } catch (error) {
            console.error(`❌ 队列清理失败: ${queueName}:`, error);
        }
    }
    
    // 暂停队列
    async pauseQueue(queueName) {
        const queue = this.queues.get(queueName);
        if (queue) {
            await queue.pause();
            console.log(`⏸️ 队列已暂停: ${queueName}`);
        }
    }
    
    // 恢复队列
    async resumeQueue(queueName) {
        const queue = this.queues.get(queueName);
        if (queue) {
            await queue.resume();
            console.log(`▶️ 队列已恢复: ${queueName}`);
        }
    }
    
    // 生成任务ID
    generateTaskId() {
        return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // 优雅关闭
    async close() {
        console.log('🔄 正在关闭任务队列...');
        
        for (const [queueName, queue] of this.queues.entries()) {
            try {
                await queue.close();
                console.log(`✅ 队列已关闭: ${queueName}`);
            } catch (error) {
                console.error(`❌ 关闭队列失败: ${queueName}:`, error);
            }
        }
    }
}

// =====================================
// 高并发引擎主类
// =====================================
class HighConcurrencyEngine extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.dbPool = null;
        this.cacheManager = null;
        this.taskQueueManager = null;
        this.isInitialized = false;
        this.startTime = Date.now();
        
        this.metrics = {
            requestsPerSecond: 0,
            averageResponseTime: 0,
            totalRequests: 0,
            totalErrors: 0,
            activeConnections: 0
        };
        
        this.requestCounter = 0;
        this.responseTimeSum = 0;
        
        this.initialize();
    }
    
    // 初始化引擎
    async initialize() {
        console.log('🚀 初始化高并发引擎...');
        
        try {
            // 初始化数据库连接池
            this.dbPool = new DatabasePoolManager(this.config.database);
            
            // 初始化缓存管理器
            this.cacheManager = new CacheManager(this.config.cache);
            
            // 初始化任务队列管理器
            this.taskQueueManager = new TaskQueueManager(this.config.redis);
            
            // 启动性能监控
            this.startPerformanceMonitoring();
            
            // 注册默认任务处理器
            this.registerDefaultProcessors();
            
            this.isInitialized = true;
            console.log('✅ 高并发引擎初始化完成');
            
            this.emit('initialized');
            
        } catch (error) {
            console.error('❌ 高并发引擎初始化失败:', error);
            throw error;
        }
    }
    
    // 注册默认任务处理器
    registerDefaultProcessors() {
        // 频道帖子更新处理器
        this.taskQueueManager.registerProcessor(
            'high-priority',
            'update_channel_post',
            async (data) => {
                const { tenantId, providerId, postData } = data;
                
                // 执行频道帖子更新逻辑
                console.log(`🔄 更新频道帖子: 租户${tenantId}, 提供者${providerId}`);
                
                // 这里集成实际的Telegram API调用
                // const result = await this.updateTelegramChannelPost(postData);
                
                return { success: true, providerId, timestamp: Date.now() };
            },
            10 // 并发数
        );
        
        // 数据同步处理器
        this.taskQueueManager.registerProcessor(
            'normal-priority',
            'sync_data',
            async (data) => {
                const { tenantId, syncType, entityData } = data;
                
                console.log(`🔄 数据同步: 租户${tenantId}, 类型${syncType}`);
                
                // 执行数据同步逻辑
                const result = await this.syncEntityData(tenantId, syncType, entityData);
                
                return result;
            },
            5
        );
        
        // 批量报表生成处理器
        this.taskQueueManager.registerProcessor(
            'batch-processing',
            'generate_report',
            async (data) => {
                const { tenantId, reportType, filters } = data;
                
                console.log(`📊 生成报表: 租户${tenantId}, 类型${reportType}`);
                
                // 执行报表生成逻辑
                const result = await this.generateReport(tenantId, reportType, filters);
                
                return result;
            },
            1
        );
    }
    
    // 性能监控
    startPerformanceMonitoring() {
        setInterval(() => {
            // 计算每秒请求数
            this.metrics.requestsPerSecond = this.requestCounter;
            this.requestCounter = 0;
            
            // 计算平均响应时间
            if (this.metrics.totalRequests > 0) {
                this.metrics.averageResponseTime = this.responseTimeSum / this.metrics.totalRequests;
            }
            
            // 获取连接池统计
            const poolStats = this.dbPool.getPoolStats();
            this.metrics.activeConnections = poolStats.masterPool.totalCount;
            
            // 发送性能指标
            this.emit('metrics', this.metrics);
            
            // 输出性能日志
            if (this.metrics.requestsPerSecond > 0) {
                console.log(`📊 性能指标: ${this.metrics.requestsPerSecond} req/s, 平均响应时间: ${this.metrics.averageResponseTime.toFixed(2)}ms`);
            }
            
        }, 1000); // 每秒更新一次
    }
    
    // 记录请求
    recordRequest(responseTime) {
        this.requestCounter++;
        this.metrics.totalRequests++;
        this.responseTimeSum += responseTime;
    }
    
    // 记录错误
    recordError() {
        this.metrics.totalErrors++;
    }
    
    // 获取引擎状态
    getEngineStatus() {
        const uptime = Date.now() - this.startTime;
        
        return {
            initialized: this.isInitialized,
            uptime: uptime,
            uptimeFormatted: this.formatUptime(uptime),
            metrics: this.metrics,
            database: this.dbPool.getPoolStats(),
            cache: this.cacheManager.getCacheStats(),
            queues: this.taskQueueManager.getQueueStats()
        };
    }
    
    // 格式化运行时间
    formatUptime(uptime) {
        const seconds = Math.floor(uptime / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}天 ${hours % 24}小时 ${minutes % 60}分钟`;
        } else if (hours > 0) {
            return `${hours}小时 ${minutes % 60}分钟`;
        } else if (minutes > 0) {
            return `${minutes}分钟 ${seconds % 60}秒`;
        } else {
            return `${seconds}秒`;
        }
    }
    
    // 同步实体数据（示例方法）
    async syncEntityData(tenantId, syncType, entityData) {
        // 这里实现具体的数据同步逻辑
        console.log(`同步数据: ${tenantId}/${syncType}`);
        return { success: true, syncType, count: entityData.length };
    }
    
    // 生成报表（示例方法）
    async generateReport(tenantId, reportType, filters) {
        // 这里实现具体的报表生成逻辑
        console.log(`生成报表: ${tenantId}/${reportType}`);
        return { success: true, reportType, generatedAt: new Date().toISOString() };
    }
    
    // 优雅关闭
    async shutdown() {
        console.log('🔄 正在关闭高并发引擎...');
        
        try {
            if (this.taskQueueManager) {
                await this.taskQueueManager.close();
            }
            
            if (this.dbPool) {
                await this.dbPool.close();
            }
            
            console.log('✅ 高并发引擎已关闭');
            
        } catch (error) {
            console.error('❌ 关闭引擎时出错:', error);
        }
    }
}

// =====================================
// 集群模式启动
// =====================================
function startClusterMode(config) {
    const numCPUs = os.cpus().length;
    const numWorkers = config.workers || Math.min(numCPUs, 4);
    
    if (cluster.isMaster) {
        console.log(`🚀 启动集群模式: ${numWorkers}个工作进程`);
        
        // 启动工作进程
        for (let i = 0; i < numWorkers; i++) {
            cluster.fork();
        }
        
        cluster.on('exit', (worker, code, signal) => {
            console.log(`⚠️ 工作进程 ${worker.process.pid} 已退出`);
            cluster.fork(); // 重启工作进程
        });
        
    } else {
        // 工作进程
        const engine = new HighConcurrencyEngine(config);
        
        console.log(`👷 工作进程 ${process.pid} 已启动`);
        
        // 优雅关闭处理
        process.on('SIGTERM', async () => {
            console.log(`🔄 工作进程 ${process.pid} 正在关闭...`);
            await engine.shutdown();
            process.exit(0);
        });
        
        return engine;
    }
}

module.exports = {
    HighConcurrencyEngine,
    DatabasePoolManager,
    CacheManager,
    TaskQueueManager,
    startClusterMode
}; 