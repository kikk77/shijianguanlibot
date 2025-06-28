/**
 * 企业级数据库连接池管理器
 * 支持读写分离、智能负载均衡、连接监控
 */

const { Pool } = require('pg');
const EventEmitter = require('events');

class ConnectionPoolManager extends EventEmitter {
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
            slowQueries: 0,
            errorCount: 0
        };
        
        this.initializePools();
        this.startHealthMonitoring();
    }
    
    // 初始化连接池
    initializePools() {
        console.log('🔄 初始化企业级数据库连接池...');
        
        // 主库连接池（写操作）
        this.masterPool = new Pool({
            host: this.config.master.host,
            port: this.config.master.port || 5432,
            database: this.config.master.database,
            user: this.config.master.user,
            password: this.config.master.password,
            max: this.config.master.max || 20,
            min: this.config.master.min || 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            acquireTimeoutMillis: 3000,
            
            // PostgreSQL性能优化
            statement_timeout: 30000,
            query_timeout: 30000,
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
        });
        
        // 从库连接池（读操作）
        this.slavePools = (this.config.slaves || []).map((slaveConfig, index) => {
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
                
                // 只读优化配置
                application_name: `slave_${index}_reader`,
                default_transaction_isolation: 'read committed'
            });
            
            pool.on('error', (err) => {
                console.error(`❌ 从库${index}连接池错误:`, err);
                this.poolStats.errorCount++;
                this.emit('slaveError', { index, error: err });
            });
            
            return { pool, index, healthy: true };
        });
        
        // 主库事件监听
        this.masterPool.on('error', (err) => {
            console.error('❌ 主库连接池错误:', err);
            this.poolStats.errorCount++;
            this.emit('masterError', err);
        });
        
        this.masterPool.on('connect', (client) => {
            this.poolStats.totalConnections++;
            this.poolStats.activeConnections++;
        });
        
        console.log(`✅ 数据库连接池初始化完成 - 主库1个, 从库${this.slavePools.length}个`);
    }
    
    // 智能查询路由（读写分离）
    async executeQuery(query, params = [], options = {}) {
        const startTime = Date.now();
        const isWriteQuery = this.isWriteQuery(query);
        const queryId = this.generateQueryId();
        
        try {
            this.poolStats.totalQueries++;
            
            let result;
            let poolType;
            
            if (isWriteQuery || options.forceMaster) {
                // 写操作或强制主库
                result = await this.masterPool.query(query, params);
                poolType = 'master';
            } else {
                // 读操作，负载均衡到健康的从库
                const slavePool = this.getHealthySlavePool();
                if (slavePool) {
                    result = await slavePool.pool.query(query, params);
                    poolType = `slave_${slavePool.index}`;
                } else {
                    // 所有从库不可用，降级到主库
                    result = await this.masterPool.query(query, params);
                    poolType = 'master_fallback';
                    console.warn('⚠️ 从库不可用，降级到主库');
                }
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
                    duration,
                    poolType
                });
            }
            
            this.emit('queryExecuted', {
                queryId,
                type: isWriteQuery ? 'write' : 'read',
                duration,
                poolType,
                success: true
            });
            
            return result;
            
        } catch (error) {
            const duration = Date.now() - startTime;
            this.poolStats.errorCount++;
            
            this.emit('queryError', {
                queryId,
                query,
                params,
                error: error.message,
                duration,
                poolType: isWriteQuery ? 'master' : 'slave'
            });
            
            throw error;
        }
    }
    
    // 批量查询优化
    async executeBatch(queries, options = {}) {
        const startTime = Date.now();
        const results = [];
        const errors = [];
        
        try {
            // 分离读写查询
            const writeQueries = [];
            const readQueries = [];
            
            queries.forEach((queryData, index) => {
                const { query, params } = queryData;
                if (this.isWriteQuery(query)) {
                    writeQueries.push({ ...queryData, originalIndex: index });
                } else {
                    readQueries.push({ ...queryData, originalIndex: index });
                }
            });
            
            // 并发执行读查询，串行执行写查询
            const readPromises = readQueries.map(async (queryData) => {
                try {
                    const result = await this.executeQuery(queryData.query, queryData.params);
                    return { index: queryData.originalIndex, result, error: null };
                } catch (error) {
                    return { index: queryData.originalIndex, result: null, error };
                }
            });
            
            // 等待所有读查询完成
            const readResults = await Promise.all(readPromises);
            
            // 串行执行写查询（保证事务一致性）
            const writeResults = [];
            for (const queryData of writeQueries) {
                try {
                    const result = await this.executeQuery(queryData.query, queryData.params);
                    writeResults.push({ index: queryData.originalIndex, result, error: null });
                } catch (error) {
                    writeResults.push({ index: queryData.originalIndex, result: null, error });
                }
            }
            
            // 合并结果
            const allResults = [...readResults, ...writeResults];
            allResults.sort((a, b) => a.index - b.index);
            
            allResults.forEach(({ result, error }) => {
                if (error) {
                    errors.push(error);
                } else {
                    results.push(result);
                }
            });
            
            const duration = Date.now() - startTime;
            console.log(`📊 批量查询完成: ${queries.length}个查询, 耗时${duration}ms, 错误${errors.length}个`);
            
            return { results, errors, duration };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ 批量查询失败: ${error.message}, 耗时${duration}ms`);
            throw error;
        }
    }
    
    // 事务支持
    async executeTransaction(queries, options = {}) {
        const client = await this.masterPool.connect();
        
        try {
            await client.query('BEGIN');
            
            const results = [];
            for (const { query, params } of queries) {
                const result = await client.query(query, params);
                results.push(result);
            }
            
            await client.query('COMMIT');
            console.log(`✅ 事务执行成功: ${queries.length}个查询`);
            
            return results;
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ 事务回滚: ${error.message}`);
            throw error;
            
        } finally {
            client.release();
        }
    }
    
    // 判断是否为写操作
    isWriteQuery(query) {
        const writeKeywords = [
            'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 
            'ALTER', 'TRUNCATE', 'REPLACE', 'MERGE'
        ];
        const upperQuery = query.trim().toUpperCase();
        return writeKeywords.some(keyword => upperQuery.startsWith(keyword));
    }
    
    // 获取健康的从库连接池
    getHealthySlavePool() {
        if (this.slavePools.length === 0) {
            return null;
        }
        
        // 轮询选择健康的从库
        const startIndex = this.slaveIndex;
        do {
            const slavePool = this.slavePools[this.slaveIndex];
            this.slaveIndex = (this.slaveIndex + 1) % this.slavePools.length;
            
            if (slavePool.healthy) {
                return slavePool;
            }
        } while (this.slaveIndex !== startIndex);
        
        return null; // 没有健康的从库
    }
    
    // 健康检查
    startHealthMonitoring() {
        setInterval(async () => {
            try {
                // 检查主库健康状态
                await this.masterPool.query('SELECT 1');
                
                // 检查从库健康状态
                for (const slavePool of this.slavePools) {
                    try {
                        await slavePool.pool.query('SELECT 1');
                        slavePool.healthy = true;
                    } catch (error) {
                        slavePool.healthy = false;
                        console.error(`❌ 从库${slavePool.index}健康检查失败:`, error.message);
                    }
                }
                
                // 更新连接池统计
                this.updatePoolStats();
                
                this.emit('healthCheck', this.getPoolStats());
                
            } catch (error) {
                console.error('❌ 主库健康检查失败:', error);
                this.emit('healthCheckFailed', error);
            }
        }, 10000); // 每10秒检查一次
    }
    
    // 更新连接池统计
    updatePoolStats() {
        this.poolStats.activeConnections = this.masterPool.totalCount || 0;
        this.poolStats.waitingClients = this.masterPool.waitingCount || 0;
    }
    
    // 获取连接池统计信息
    getPoolStats() {
        return {
            ...this.poolStats,
            masterPool: {
                totalCount: this.masterPool.totalCount || 0,
                idleCount: this.masterPool.idleCount || 0,
                waitingCount: this.masterPool.waitingCount || 0
            },
            slavePools: this.slavePools.map((slavePool) => ({
                index: slavePool.index,
                healthy: slavePool.healthy,
                totalCount: slavePool.pool.totalCount || 0,
                idleCount: slavePool.pool.idleCount || 0,
                waitingCount: slavePool.pool.waitingCount || 0
            }))
        };
    }
    
    // 生成查询ID
    generateQueryId() {
        return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // 预热连接池
    async warmupPools() {
        console.log('🔥 预热数据库连接池...');
        
        try {
            // 预热主库连接
            const masterPromises = Array(this.config.master.min || 5).fill().map(() => 
                this.masterPool.query('SELECT 1')
            );
            await Promise.all(masterPromises);
            
            // 预热从库连接
            for (const slavePool of this.slavePools) {
                const slavePromises = Array(slavePool.pool.options.min || 10).fill().map(() => 
                    slavePool.pool.query('SELECT 1')
                );
                await Promise.all(slavePromises);
            }
            
            console.log('✅ 连接池预热完成');
            
        } catch (error) {
            console.error('❌ 连接池预热失败:', error);
        }
    }
    
    // 优雅关闭
    async close() {
        console.log('🔄 正在关闭数据库连接池...');
        
        try {
            // 关闭主库连接池
            await this.masterPool.end();
            
            // 关闭从库连接池
            for (const slavePool of this.slavePools) {
                await slavePool.pool.end();
            }
            
            console.log('✅ 数据库连接池已关闭');
            
        } catch (error) {
            console.error('❌ 关闭连接池时出错:', error);
        }
    }
}

module.exports = ConnectionPoolManager; 