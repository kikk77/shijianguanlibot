/**
 * 企业级系统配置
 * 支持多租户、高并发、EAV存储
 */

const config = {
    // 数据库配置 - PostgreSQL集群
    database: {
        master: {
            host: process.env.DB_MASTER_HOST || 'localhost',
            port: parseInt(process.env.DB_MASTER_PORT) || 5432,
            database: process.env.DB_NAME || 'telegram_bot_enterprise',
            user: process.env.DB_USER || 'bot_user',
            password: process.env.DB_PASSWORD || '',
            max: parseInt(process.env.DB_MASTER_MAX_CONNECTIONS) || 20,
            min: parseInt(process.env.DB_MASTER_MIN_CONNECTIONS) || 5
        },
        
        slaves: (process.env.DB_SLAVE_HOSTS || '').split(',').filter(Boolean).map(host => ({
            host: host.trim(),
            port: 5432,
            max: 50,
            min: 10
        })),
        
        pool: {
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            acquireTimeoutMillis: 3000
        }
    },
    
    // Redis缓存配置
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || '',
        db: parseInt(process.env.REDIS_DB) || 0,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
    },
    
    // 缓存层配置
    cache: {
        maxMemorySize: parseInt(process.env.CACHE_MEMORY_SIZE) || 1000,
        defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL) || 300
    },
    
    // 多租户配置
    tenant: {
        defaultLimits: {
            basic: {
                max_providers: 5,
                max_concurrent_users: 100,
                max_api_calls_per_hour: 1000
            },
            pro: {
                max_providers: 50,
                max_concurrent_users: 1000,
                max_api_calls_per_hour: 10000
            },
            enterprise: {
                max_providers: -1,
                max_concurrent_users: 10000,
                max_api_calls_per_hour: 100000
            }
        },
        
        billing: {
            plans: {
                basic: { monthly: 29, yearly: 290 },
                pro: { monthly: 99, yearly: 990 },
                enterprise: { monthly: 299, yearly: 2990 }
            }
        }
    },
    
    // 服务器配置
    server: {
        port: parseInt(process.env.PORT) || 3000,
        host: process.env.HOST || '0.0.0.0',
        cluster: {
            enabled: process.env.CLUSTER_MODE === 'true',
            workers: parseInt(process.env.CLUSTER_WORKERS) || require('os').cpus().length
        }
    },
    
    // 监控配置
    monitoring: {
        metrics: {
            enabled: process.env.METRICS_ENABLED !== 'false',
            interval: parseInt(process.env.METRICS_INTERVAL) || 1000
        },
        
        logging: {
            level: process.env.LOG_LEVEL || 'info',
            format: process.env.LOG_FORMAT || 'json'
        }
    },
    
    // 安全配置
    security: {
        rateLimit: {
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000,
            max: parseInt(process.env.RATE_LIMIT_MAX) || 100
        },
        
        jwt: {
            secret: process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex'),
            expiresIn: process.env.JWT_EXPIRES_IN || '24h'
        }
    }
};

module.exports = config; 