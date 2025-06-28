# Telegram频道机器人 - 企业级架构设计

## 概述
将单租户SQLite应用升级为支持**万级并发**、**毫秒级检索**、**多租户SaaS**的企业级产品。

## 核心架构优化

### 1. 数据库架构升级

#### 当前问题
- SQLite单文件数据库，无法支持高并发
- 关系型设计不够灵活，难以适配不同客户需求
- 无多租户隔离机制

#### 解决方案：EAV存储 + 分布式数据库

```javascript
// EAV实体属性值模型设计
CREATE TABLE entities (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- provider, booking, schedule等
    entity_code VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_tenant_type (tenant_id, entity_type),
    INDEX idx_entity_code (entity_code)
);

CREATE TABLE attributes (
    id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    attribute_name VARCHAR(100) NOT NULL,
    attribute_type ENUM('string', 'number', 'boolean', 'datetime', 'json') NOT NULL,
    is_searchable BOOLEAN DEFAULT FALSE,
    is_required BOOLEAN DEFAULT FALSE,
    default_value TEXT,
    UNIQUE KEY uk_entity_attr (entity_type, attribute_name)
);

CREATE TABLE entity_values (
    id BIGSERIAL PRIMARY KEY,
    entity_id BIGINT NOT NULL,
    attribute_id BIGINT NOT NULL,
    value_string TEXT,
    value_number DECIMAL(20,8),
    value_boolean BOOLEAN,
    value_datetime TIMESTAMP,
    value_json JSON,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (entity_id) REFERENCES entities(id),
    FOREIGN KEY (attribute_id) REFERENCES attributes(id),
    INDEX idx_entity_attr (entity_id, attribute_id),
    INDEX idx_tenant_search (tenant_id, attribute_id, value_string(255)),
    INDEX idx_value_number (attribute_id, value_number),
    INDEX idx_value_datetime (attribute_id, value_datetime)
);
```

### 2. 微服务架构

#### 服务拆分
```
┌─────────────────┐
│   API Gateway   │ ← 统一入口、限流、认证
└─────────────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼──┐
│Bot服务│ │管理│
│       │ │后台│
└───┬───┘ └──┬──┘
    │        │
┌───▼────────▼───┐
│   数据服务层    │ ← EAV存储引擎
└─────┬──────────┘
      │
┌─────▼─────┐
│消息队列层│ ← 异步任务处理
└───────────┘
```

### 3. 高并发优化设计

#### 连接池 + 读写分离
```javascript
// 数据库连接池配置
const poolConfig = {
    // 写库（主库）
    master: {
        host: process.env.DB_MASTER_HOST,
        port: 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        max: 20,                    // 最大连接数
        min: 5,                     // 最小连接数
        acquireTimeoutMillis: 3000, // 获取连接超时
        idleTimeoutMillis: 30000,   // 空闲连接超时
    },
    
    // 读库（从库）- 支持多个
    slaves: [
        {
            host: process.env.DB_SLAVE1_HOST,
            max: 50,    // 读库连接数更多
            // ... 其他配置
        },
        {
            host: process.env.DB_SLAVE2_HOST,
            max: 50,
            // ... 其他配置
        }
    ]
};

// 智能路由：读写分离
class DatabaseRouter {
    constructor(poolConfig) {
        this.masterPool = new Pool(poolConfig.master);
        this.slavePools = poolConfig.slaves.map(config => new Pool(config));
        this.slaveIndex = 0;
    }
    
    // 写操作路由到主库
    async executeWrite(query, params) {
        return this.masterPool.query(query, params);
    }
    
    // 读操作路由到从库（负载均衡）
    async executeRead(query, params) {
        const slavePool = this.slavePools[this.slaveIndex];
        this.slaveIndex = (this.slaveIndex + 1) % this.slavePools.length;
        return slavePool.query(query, params);
    }
}
```

#### 缓存层设计
```javascript
// 多层缓存架构
class CacheManager {
    constructor() {
        // L1: 内存缓存（最快）
        this.memoryCache = new Map();
        
        // L2: Redis缓存（共享）
        this.redisClient = new Redis({
            host: process.env.REDIS_HOST,
            port: 6379,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            lazyConnect: true
        });
        
        // L3: 数据库（最慢）
        this.dbRouter = new DatabaseRouter(poolConfig);
    }
    
    async get(key, tenantId) {
        const cacheKey = `${tenantId}:${key}`;
        
        // L1缓存检查
        if (this.memoryCache.has(cacheKey)) {
            return this.memoryCache.get(cacheKey);
        }
        
        // L2缓存检查
        const redisValue = await this.redisClient.get(cacheKey);
        if (redisValue) {
            const data = JSON.parse(redisValue);
            this.memoryCache.set(cacheKey, data);
            return data;
        }
        
        // L3数据库查询
        const dbData = await this.queryFromDatabase(key, tenantId);
        
        // 回写缓存
        await this.redisClient.setex(cacheKey, 300, JSON.stringify(dbData));
        this.memoryCache.set(cacheKey, dbData);
        
        return dbData;
    }
}
```

### 4. 超强检索系统

#### Elasticsearch集成
```javascript
// 全文检索引擎配置
class SearchEngine {
    constructor() {
        this.client = new elasticsearch.Client({
            hosts: process.env.ES_HOSTS.split(','),
            maxRetries: 3,
            requestTimeout: 60000,
        });
    }
    
    // 索引结构设计
    async createIndexTemplate() {
        return this.client.indices.putTemplate({
            name: 'telegram_bot_template',
            body: {
                index_patterns: ['telegram_bot_*'],
                mappings: {
                    properties: {
                        tenant_id: { type: 'keyword' },
                        entity_type: { type: 'keyword' },
                        entity_id: { type: 'long' },
                        
                        // 可搜索字段
                        searchable_text: {
                            type: 'text',
                            analyzer: 'ik_max_word',  // 中文分词
                            search_analyzer: 'ik_smart'
                        },
                        
                        // 多语言支持
                        title: {
                            type: 'text',
                            fields: {
                                en: { type: 'text', analyzer: 'english' },
                                zh: { type: 'text', analyzer: 'ik_max_word' }
                            }
                        },
                        
                        // 地理位置
                        location: { type: 'geo_point' },
                        
                        // 时间范围
                        available_time: { type: 'date_range' },
                        
                        // 价格区间
                        price_range: { type: 'integer_range' },
                        
                        // 动态属性（EAV）
                        dynamic_attributes: {
                            type: 'nested',
                            properties: {
                                name: { type: 'keyword' },
                                value_string: { type: 'text' },
                                value_number: { type: 'double' },
                                value_boolean: { type: 'boolean' },
                                value_date: { type: 'date' }
                            }
                        }
                    }
                }
            }
        });
    }
    
    // 智能搜索（支持语义化、模糊匹配、范围查询）
    async smartSearch(tenantId, query) {
        return this.client.search({
            index: `telegram_bot_${tenantId}`,
            body: {
                query: {
                    bool: {
                        must: [
                            { term: { tenant_id: tenantId } }
                        ],
                        should: [
                            // 全文匹配
                            {
                                multi_match: {
                                    query: query.text,
                                    fields: ['searchable_text^2', 'title.zh^3'],
                                    type: 'best_fields',
                                    fuzziness: 'AUTO'
                                }
                            },
                            
                            // 价格范围
                            query.priceRange ? {
                                range: {
                                    'price_range.gte': query.priceRange.min,
                                    'price_range.lte': query.priceRange.max
                                }
                            } : null,
                            
                            // 时间范围
                            query.timeRange ? {
                                range: {
                                    'available_time': {
                                        gte: query.timeRange.start,
                                        lte: query.timeRange.end
                                    }
                                }
                            } : null,
                            
                        ].filter(Boolean),
                        
                        // 动态属性查询
                        filter: query.dynamicFilters ? query.dynamicFilters.map(filter => ({
                            nested: {
                                path: 'dynamic_attributes',
                                query: {
                                    bool: {
                                        must: [
                                            { term: { 'dynamic_attributes.name': filter.name } },
                                            { term: { [`dynamic_attributes.value_${filter.type}`]: filter.value } }
                                        ]
                                    }
                                }
                            }
                        })) : []
                    }
                },
                
                // 聚合统计
                aggs: {
                    price_stats: {
                        stats: { field: 'price_range.gte' }
                    },
                    popular_attributes: {
                        nested: { path: 'dynamic_attributes' },
                        aggs: {
                            attributes: {
                                terms: { field: 'dynamic_attributes.name', size: 10 }
                            }
                        }
                    }
                },
                
                // 高亮显示
                highlight: {
                    fields: {
                        'searchable_text': {},
                        'title.zh': {}
                    }
                },
                
                size: query.size || 20,
                from: query.from || 0,
                sort: query.sort || [{ _score: 'desc' }]
            }
        });
    }
}
```

### 5. 多租户SaaS架构

#### 租户管理系统
```javascript
// 租户配置管理
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    domain VARCHAR(100) UNIQUE,
    plan_type ENUM('basic', 'pro', 'enterprise') NOT NULL,
    status ENUM('active', 'suspended', 'trial') DEFAULT 'trial',
    
    -- 功能限制
    max_providers INTEGER DEFAULT 5,
    max_concurrent_users INTEGER DEFAULT 100,
    max_api_calls_per_hour INTEGER DEFAULT 1000,
    
    -- 配置信息
    bot_token VARCHAR(255),
    channel_id VARCHAR(100),
    webhook_url VARCHAR(255),
    custom_domain VARCHAR(100),
    
    -- 计费信息
    billing_cycle ENUM('monthly', 'yearly') DEFAULT 'monthly',
    next_billing_date TIMESTAMP,
    total_usage_current_cycle INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

// 租户级别的功能配置
CREATE TABLE tenant_features (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    feature_name VARCHAR(50) NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    config_json JSON,
    UNIQUE KEY uk_tenant_feature (tenant_id, feature_name)
);

// 租户级别的属性模板
CREATE TABLE tenant_attribute_templates (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    entity_type VARCHAR(50) NOT NULL,
    template_name VARCHAR(100) NOT NULL,
    attributes_config JSON NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### 智能租户路由
```javascript
class TenantManager {
    constructor() {
        this.tenantCache = new Map();
        this.rateLimiters = new Map();
    }
    
    // 基于域名/API Key识别租户
    async identifyTenant(req) {
        // 方式1: 子域名识别
        const subdomain = this.extractSubdomain(req.hostname);
        if (subdomain) {
            return this.getTenantByDomain(subdomain);
        }
        
        // 方式2: API Key识别
        const apiKey = req.headers['x-api-key'];
        if (apiKey) {
            return this.getTenantByApiKey(apiKey);
        }
        
        // 方式3: JWT Token识别
        const token = req.headers.authorization;
        if (token) {
            return this.getTenantByToken(token);
        }
        
        throw new Error('无法识别租户');
    }
    
    // 租户级别限流
    async checkRateLimit(tenantId, operation) {
        const key = `${tenantId}:${operation}`;
        
        if (!this.rateLimiters.has(key)) {
            const tenant = await this.getTenant(tenantId);
            const limit = this.getOperationLimit(tenant.plan_type, operation);
            
            this.rateLimiters.set(key, new RateLimiter({
                tokensPerInterval: limit,
                interval: 'hour'
            }));
        }
        
        const limiter = this.rateLimiters.get(key);
        return limiter.tryRemoveTokens(1);
    }
    
    // 动态数据库连接
    async getDatabaseConnection(tenantId) {
        const tenant = await this.getTenant(tenantId);
        
        // 企业客户可以使用独立数据库
        if (tenant.plan_type === 'enterprise' && tenant.dedicated_db) {
            return this.createDedicatedConnection(tenant.db_config);
        }
        
        // 共享数据库连接
        return this.getSharedConnection();
    }
}
```

### 6. 消息队列异步处理

#### 高并发任务队列
```javascript
// 使用Bull Queue处理异步任务
const Queue = require('bull');
const Redis = require('ioredis');

class TaskManager {
    constructor() {
        this.redis = new Redis(process.env.REDIS_URL);
        
        // 不同优先级的队列
        this.highPriorityQueue = new Queue('high priority', process.env.REDIS_URL);
        this.normalQueue = new Queue('normal priority', process.env.REDIS_URL);
        this.batchQueue = new Queue('batch processing', process.env.REDIS_URL);
        
        this.setupProcessors();
    }
    
    setupProcessors() {
        // 高优先级：用户交互任务
        this.highPriorityQueue.process('update_channel_post', 10, async (job) => {
            const { tenantId, providerId, postData } = job.data;
            return this.updateChannelPost(tenantId, providerId, postData);
        });
        
        // 普通优先级：数据同步任务
        this.normalQueue.process('sync_data', 5, async (job) => {
            const { tenantId, syncType, data } = job.data;
            return this.syncData(tenantId, syncType, data);
        });
        
        // 批量处理：报表生成、数据导出等
        this.batchQueue.process('generate_report', 1, async (job) => {
            const { tenantId, reportType, filters } = job.data;
            return this.generateReport(tenantId, reportType, filters);
        });
    }
    
    // 智能任务分发
    async addTask(taskType, priority, tenantId, data) {
        const queue = this.getQueueByPriority(priority);
        
        return queue.add(taskType, {
            tenantId,
            ...data,
            timestamp: Date.now()
        }, {
            priority: priority,
            delay: data.delay || 0,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            },
            removeOnComplete: 100,
            removeOnFail: 50
        });
    }
}
```

### 7. 监控和运维

#### 性能监控系统
```javascript
// APM监控集成
const newrelic = require('newrelic');
const prometheus = require('prom-client');

class MonitoringManager {
    constructor() {
        // Prometheus指标
        this.httpRequestDuration = new prometheus.Histogram({
            name: 'http_request_duration_seconds',
            help: 'HTTP请求耗时',
            labelNames: ['method', 'route', 'status_code', 'tenant_id']
        });
        
        this.databaseQueryDuration = new prometheus.Histogram({
            name: 'database_query_duration_seconds',
            help: '数据库查询耗时',
            labelNames: ['query_type', 'tenant_id']
        });
        
        this.activeConnections = new prometheus.Gauge({
            name: 'active_database_connections',
            help: '活跃数据库连接数'
        });
        
        this.queueSize = new prometheus.Gauge({
            name: 'task_queue_size',
            help: '任务队列长度',
            labelNames: ['queue_name']
        });
    }
    
    // 中间件：请求监控
    requestMonitoring() {
        return async (req, res, next) => {
            const start = Date.now();
            
            res.on('finish', () => {
                const duration = (Date.now() - start) / 1000;
                const tenantId = req.tenantId || 'unknown';
                
                this.httpRequestDuration
                    .labels(req.method, req.route?.path || req.path, res.statusCode, tenantId)
                    .observe(duration);
                
                // 异常响应时间告警
                if (duration > 5) {
                    this.sendAlert('slow_request', {
                        duration,
                        path: req.path,
                        tenantId
                    });
                }
            });
            
            next();
        };
    }
    
    // 智能告警
    async sendAlert(alertType, data) {
        // 发送到Slack/钉钉/邮件
        const alert = {
            type: alertType,
            severity: this.getAlertSeverity(alertType, data),
            timestamp: new Date().toISOString(),
            data
        };
        
        // 根据严重程度选择通知渠道
        if (alert.severity === 'critical') {
            await this.sendToSlack(alert);
            await this.sendToEmail(alert);
        } else if (alert.severity === 'warning') {
            await this.sendToSlack(alert);
        }
    }
}
```

## 部署架构

### Docker Compose集群
```yaml
version: '3.8'
services:
  # API网关
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl
    
  # 应用服务（多实例）
  app:
    build: .
    replicas: 3
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres-master
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres-master
      - redis
      - elasticsearch
    
  # 主数据库
  postgres-master:
    image: postgres:15
    environment:
      - POSTGRES_DB=telegram_bot
      - POSTGRES_USER=bot_user
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_master_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/
    
  # 从数据库（读副本）
  postgres-slave:
    image: postgres:15
    environment:
      - PGUSER=postgres
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - PGPASSWORD=${DB_PASSWORD}
    command: |
      bash -c "
        until pg_basebackup --pgdata=/var/lib/postgresql/data --format=p --write-recovery-conf --checkpoint=fast --label=myclone --host=postgres-master --port=5432 --username=replicator --verbose --progress --wal-method=stream; do
        echo 'Waiting for master to connect...'
        sleep 1s
        done
        echo 'Backup done, starting replica...'
        chown -R postgres:postgres /var/lib/postgresql/data
        chmod 0700 /var/lib/postgresql/data
        sudo -u postgres postgres
      "
    
  # Redis缓存
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 2gb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    
  # Elasticsearch搜索引擎
  elasticsearch:
    image: elasticsearch:8.8.0
    environment:
      - node.name=es01
      - cluster.name=telegram-bot-cluster
      - discovery.type=single-node
      - "ES_JAVA_OPTS=-Xms2g -Xmx2g"
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
    
  # 任务队列处理器
  worker:
    build: .
    command: node worker.js
    replicas: 2
    environment:
      - NODE_ENV=production
      - WORKER_MODE=true
    depends_on:
      - redis
      - postgres-master

volumes:
  postgres_master_data:
  postgres_slave_data:
  redis_data:
  elasticsearch_data:
```

## 性能指标预期

### 并发能力
- **QPS**: 10,000+ 查询/秒
- **并发用户**: 50,000+ 在线用户
- **响应时间**: 平均 < 100ms
- **可用性**: 99.9%+

### 扩展能力
- **租户数量**: 10,000+ 租户
- **数据规模**: 1TB+ 数据存储
- **检索性能**: 毫秒级全文检索
- **横向扩展**: 支持无限水平扩展

## 商业化收费模型

### 订阅套餐
1. **基础版** ($29/月)
   - 5个服务提供者
   - 1,000次API调用/小时
   - 基础功能
   
2. **专业版** ($99/月)  
   - 50个服务提供者
   - 10,000次API调用/小时
   - 高级搜索、报表分析
   
3. **企业版** ($299/月)
   - 无限服务提供者
   - 无限API调用
   - 独立数据库、定制开发

### 按需计费
- API调用: $0.001/次
- 存储空间: $0.1/GB/月
- 搜索查询: $0.01/次

这个企业级架构支持从小规模到超大规模的平滑扩展，具备完整的商业化能力。 