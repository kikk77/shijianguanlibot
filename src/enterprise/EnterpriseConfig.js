/**
 * 企业级系统配置
 * 支持环境变量、多租户配置、性能调优
 */

const fs = require('fs');
const path = require('path');

class EnterpriseConfig {
    constructor() {
        this.config = this.loadConfiguration();
        this.validateConfiguration();
    }
    
    // 加载配置
    loadConfiguration() {
        return {
            // 数据库配置 - 支持读写分离
            database: {
                // 主库配置（写操作）
                master: {
                    host: process.env.DB_MASTER_HOST || 'localhost',
                    port: parseInt(process.env.DB_MASTER_PORT) || 5432,
                    database: process.env.DB_NAME || 'telegram_bot_enterprise',
                    user: process.env.DB_USER || 'bot_user',
                    password: process.env.DB_PASSWORD || '',
                    max: parseInt(process.env.DB_MASTER_MAX_CONNECTIONS) || 20,
                    min: parseInt(process.env.DB_MASTER_MIN_CONNECTIONS) || 5,
                    ssl: process.env.DB_SSL === 'true' ? {
                        rejectUnauthorized: false
                    } : false
                },
                
                // 从库配置（读操作）
                slaves: this.parseSlaveHosts(process.env.DB_SLAVE_HOSTS),
                
                // 连接池配置
                pool: {
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 5000,
                    acquireTimeoutMillis: 3000,
                    createTimeoutMillis: 3000,
                    destroyTimeoutMillis: 5000,
                    reapIntervalMillis: 1000,
                    createRetryIntervalMillis: 200
                }
            },
            
            // Redis缓存配置
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT) || 6379,
                password: process.env.REDIS_PASSWORD || '',
                db: parseInt(process.env.REDIS_DB) || 0,
                
                // 集群配置
                cluster: process.env.REDIS_CLUSTER === 'true',
                nodes: this.parseRedisNodes(process.env.REDIS_CLUSTER_NODES),
                
                // 性能配置
                retryDelayOnFailover: 100,
                maxRetriesPerRequest: 3,
                lazyConnect: true,
                keepAlive: 30000,
                connectTimeout: 10000,
                commandTimeout: 5000,
                
                // 内存限制
                maxMemoryPolicy: 'allkeys-lru'
            },
            
            // 缓存管理配置
            cache: {
                // 多层缓存配置
                maxMemorySize: parseInt(process.env.CACHE_MEMORY_SIZE) || 1000,
                defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL) || 300,
                
                // L1缓存（内存）
                memory: {
                    maxSize: parseInt(process.env.L1_CACHE_SIZE) || 1000,
                    ttl: parseInt(process.env.L1_CACHE_TTL) || 60
                },
                
                // L2缓存（Redis）
                redis: {
                    defaultTTL: parseInt(process.env.L2_CACHE_TTL) || 300,
                    maxTTL: parseInt(process.env.L2_CACHE_MAX_TTL) || 3600
                }
            },
            
            // 任务队列配置
            queue: {
                redis: this.getRedisConfig(),
                
                // 队列配置
                queues: [
                    {
                        name: 'high-priority',
                        concurrency: parseInt(process.env.HIGH_PRIORITY_CONCURRENCY) || 20,
                        priority: 1,
                        attempts: 3,
                        backoffDelay: 2000
                    },
                    {
                        name: 'normal-priority',
                        concurrency: parseInt(process.env.NORMAL_PRIORITY_CONCURRENCY) || 10,
                        priority: 2,
                        attempts: 3,
                        backoffDelay: 5000
                    },
                    {
                        name: 'low-priority',
                        concurrency: parseInt(process.env.LOW_PRIORITY_CONCURRENCY) || 5,
                        priority: 3,
                        attempts: 2,
                        backoffDelay: 10000
                    },
                    {
                        name: 'batch-processing',
                        concurrency: parseInt(process.env.BATCH_CONCURRENCY) || 2,
                        priority: 4,
                        attempts: 1,
                        backoffDelay: 30000
                    }
                ],
                
                // 清理配置
                cleanup: {
                    removeOnComplete: parseInt(process.env.QUEUE_KEEP_COMPLETED) || 100,
                    removeOnFail: parseInt(process.env.QUEUE_KEEP_FAILED) || 50,
                    cleanupInterval: parseInt(process.env.QUEUE_CLEANUP_INTERVAL) || 3600000
                }
            },
            
            // Elasticsearch搜索引擎配置
            elasticsearch: {
                enabled: process.env.ELASTICSEARCH_ENABLED === 'true',
                hosts: this.parseElasticsearchHosts(process.env.ELASTICSEARCH_HOSTS),
                
                // 认证配置
                auth: process.env.ELASTICSEARCH_USERNAME ? {
                    username: process.env.ELASTICSEARCH_USERNAME,
                    password: process.env.ELASTICSEARCH_PASSWORD
                } : null,
                
                // 性能配置
                maxRetries: parseInt(process.env.ES_MAX_RETRIES) || 3,
                requestTimeout: parseInt(process.env.ES_REQUEST_TIMEOUT) || 60000,
                pingTimeout: parseInt(process.env.ES_PING_TIMEOUT) || 3000,
                
                // 索引配置
                indexPrefix: process.env.ES_INDEX_PREFIX || 'telegram_bot',
                shards: parseInt(process.env.ES_SHARDS) || 1,
                replicas: parseInt(process.env.ES_REPLICAS) || 1
            },
            
            // 多租户配置
            tenant: {
                // 默认限制
                defaultLimits: {
                    basic: {
                        max_providers: 5,
                        max_concurrent_users: 100,
                        max_api_calls_per_hour: 1000,
                        max_storage_gb: 1
                    },
                    pro: {
                        max_providers: 50,
                        max_concurrent_users: 1000,
                        max_api_calls_per_hour: 10000,
                        max_storage_gb: 10
                    },
                    enterprise: {
                        max_providers: -1, // 无限制
                        max_concurrent_users: 10000,
                        max_api_calls_per_hour: 100000,
                        max_storage_gb: 100
                    }
                },
                
                // 租户识别配置
                identification: {
                    methods: ['subdomain', 'apikey', 'custom_domain', 'path_param'],
                    cacheTimeout: parseInt(process.env.TENANT_CACHE_TIMEOUT) || 300,
                    defaultDomain: process.env.DEFAULT_DOMAIN || 'localhost'
                },
                
                // 计费配置
                billing: {
                    currency: process.env.BILLING_CURRENCY || 'USD',
                    plans: {
                        basic: { monthly: 29, yearly: 290 },
                        pro: { monthly: 99, yearly: 990 },
                        enterprise: { monthly: 299, yearly: 2990 }
                    },
                    
                    // 超量计费
                    overageRates: {
                        api_calls: 0.001, // 每次API调用
                        storage: 0.1,     // 每GB存储/月
                        bandwidth: 0.05   // 每GB流量
                    }
                }
            },
            
            // 应用服务器配置
            server: {
                port: parseInt(process.env.PORT) || 3000,
                host: process.env.HOST || '0.0.0.0',
                
                // 集群模式配置
                cluster: {
                    enabled: process.env.CLUSTER_MODE === 'true',
                    workers: parseInt(process.env.CLUSTER_WORKERS) || require('os').cpus().length,
                    maxMemory: process.env.CLUSTER_MAX_MEMORY || '1gb'
                },
                
                // HTTP配置
                timeout: parseInt(process.env.HTTP_TIMEOUT) || 30000,
                keepAliveTimeout: parseInt(process.env.KEEP_ALIVE_TIMEOUT) || 5000,
                maxConnections: parseInt(process.env.MAX_CONNECTIONS) || 1000,
                
                // 请求限制
                bodyLimit: process.env.BODY_LIMIT || '10mb',
                parameterLimit: parseInt(process.env.PARAMETER_LIMIT) || 1000,
                
                // CORS配置
                cors: {
                    enabled: process.env.CORS_ENABLED !== 'false',
                    origin: this.parseCorsOrigins(process.env.CORS_ORIGINS),
                    credentials: process.env.CORS_CREDENTIALS === 'true'
                }
            },
            
            // 监控和日志配置
            monitoring: {
                // 性能监控
                metrics: {
                    enabled: process.env.METRICS_ENABLED !== 'false',
                    interval: parseInt(process.env.METRICS_INTERVAL) || 1000,
                    prometheus: {
                        enabled: process.env.PROMETHEUS_ENABLED === 'true',
                        port: parseInt(process.env.PROMETHEUS_PORT) || 9090,
                        path: process.env.PROMETHEUS_PATH || '/metrics'
                    }
                },
                
                // APM配置
                apm: {
                    enabled: process.env.APM_ENABLED === 'true',
                    serviceName: process.env.APM_SERVICE_NAME || 'telegram-bot-enterprise',
                    serverUrl: process.env.APM_SERVER_URL,
                    secretToken: process.env.APM_SECRET_TOKEN
                },
                
                // 健康检查
                health: {
                    enabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
                    path: process.env.HEALTH_CHECK_PATH || '/health',
                    interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000
                },
                
                // 日志配置
                logging: {
                    level: process.env.LOG_LEVEL || 'info',
                    format: process.env.LOG_FORMAT || 'json',
                    file: process.env.LOG_FILE,
                    maxSize: process.env.LOG_MAX_SIZE || '100mb',
                    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
                    
                    // 结构化日志
                    structured: process.env.STRUCTURED_LOGGING === 'true',
                    fields: {
                        service: 'telegram-bot-enterprise',
                        version: process.env.APP_VERSION || '1.0.0',
                        environment: process.env.NODE_ENV || 'production'
                    }
                }
            },
            
            // 安全配置
            security: {
                // 加密配置
                encryption: {
                    algorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
                    keyDerivation: process.env.KEY_DERIVATION || 'pbkdf2',
                    saltLength: parseInt(process.env.SALT_LENGTH) || 32,
                    iterations: parseInt(process.env.PBKDF2_ITERATIONS) || 100000
                },
                
                // JWT配置
                jwt: {
                    secret: process.env.JWT_SECRET || this.generateRandomSecret(),
                    algorithm: process.env.JWT_ALGORITHM || 'HS256',
                    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
                    issuer: process.env.JWT_ISSUER || 'telegram-bot-enterprise'
                },
                
                // 限流配置
                rateLimit: {
                    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000, // 15分钟
                    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
                    message: 'Too many requests from this IP',
                    standardHeaders: true,
                    legacyHeaders: false
                },
                
                // HTTPS配置
                https: {
                    enabled: process.env.HTTPS_ENABLED === 'true',
                    port: parseInt(process.env.HTTPS_PORT) || 443,
                    cert: process.env.HTTPS_CERT_PATH,
                    key: process.env.HTTPS_KEY_PATH,
                    ca: process.env.HTTPS_CA_PATH
                }
            },
            
            // 外部服务配置
            external: {
                // Telegram配置
                telegram: {
                    botToken: process.env.BOT_TOKEN,
                    webhookUrl: process.env.WEBHOOK_URL,
                    channelId: process.env.CHANNEL_ID,
                    apiUrl: process.env.TELEGRAM_API_URL || 'https://api.telegram.org',
                    
                    // Webhook配置
                    webhook: {
                        enabled: process.env.WEBHOOK_ENABLED === 'true',
                        path: process.env.WEBHOOK_PATH || '/webhook',
                        secretToken: process.env.WEBHOOK_SECRET_TOKEN
                    }
                },
                
                // 邮件服务配置
                email: {
                    enabled: process.env.EMAIL_ENABLED === 'true',
                    provider: process.env.EMAIL_PROVIDER || 'smtp',
                    smtp: {
                        host: process.env.SMTP_HOST,
                        port: parseInt(process.env.SMTP_PORT) || 587,
                        secure: process.env.SMTP_SECURE === 'true',
                        auth: {
                            user: process.env.SMTP_USER,
                            pass: process.env.SMTP_PASS
                        }
                    }
                },
                
                // 短信服务配置
                sms: {
                    enabled: process.env.SMS_ENABLED === 'true',
                    provider: process.env.SMS_PROVIDER,
                    apiKey: process.env.SMS_API_KEY,
                    apiSecret: process.env.SMS_API_SECRET
                }
            },
            
            // 开发和调试配置
            development: {
                debug: process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true',
                hotReload: process.env.HOT_RELOAD === 'true',
                mockData: process.env.MOCK_DATA === 'true',
                
                // 性能分析
                profiling: {
                    enabled: process.env.PROFILING_ENABLED === 'true',
                    interval: parseInt(process.env.PROFILING_INTERVAL) || 60000,
                    heapSnapshot: process.env.HEAP_SNAPSHOT === 'true'
                }
            }
        };
    }
    
    // 解析从库主机
    parseSlaveHosts(slavesStr) {
        if (!slavesStr) return [];
        
        return slavesStr.split(',').map(hostStr => {
            const [host, port = '5432', maxConn = '50'] = hostStr.split(':');
            return {
                host: host.trim(),
                port: parseInt(port),
                max: parseInt(maxConn),
                min: Math.min(10, parseInt(maxConn))
            };
        });
    }
    
    // 解析Redis节点
    parseRedisNodes(nodesStr) {
        if (!nodesStr) return [];
        
        return nodesStr.split(',').map(nodeStr => {
            const [host, port = '6379'] = nodeStr.split(':');
            return {
                host: host.trim(),
                port: parseInt(port)
            };
        });
    }
    
    // 解析Elasticsearch主机
    parseElasticsearchHosts(hostsStr) {
        if (!hostsStr) return ['http://localhost:9200'];
        
        return hostsStr.split(',').map(host => host.trim());
    }
    
    // 解析CORS源
    parseCorsOrigins(originsStr) {
        if (!originsStr) return true;
        if (originsStr === '*') return true;
        
        return originsStr.split(',').map(origin => origin.trim());
    }
    
    // 获取Redis配置
    getRedisConfig() {
        const redisConfig = this.config.redis;
        
        if (redisConfig.cluster) {
            return {
                host: redisConfig.host,
                port: redisConfig.port,
                password: redisConfig.password,
                db: redisConfig.db
            };
        }
        
        return {
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password,
            db: redisConfig.db
        };
    }
    
    // 生成随机密钥
    generateRandomSecret() {
        const crypto = require('crypto');
        return crypto.randomBytes(64).toString('hex');
    }
    
    // 验证配置
    validateConfiguration() {
        const errors = [];
        
        // 验证必需的环境变量
        const required = [
            'DB_PASSWORD',
            'REDIS_HOST'
        ];
        
        for (const key of required) {
            if (!process.env[key]) {
                errors.push(`Missing required environment variable: ${key}`);
            }
        }
        
        // 验证数据库配置
        if (!this.config.database.master.host) {
            errors.push('Database master host is required');
        }
        
        // 验证端口号
        if (this.config.server.port < 1 || this.config.server.port > 65535) {
            errors.push('Invalid server port number');
        }
        
        if (errors.length > 0) {
            console.error('❌ Configuration validation failed:');
            errors.forEach(error => console.error(`  - ${error}`));
            throw new Error('Invalid configuration');
        }
        
        console.log('✅ Configuration validation passed');
    }
    
    // 获取配置
    get(path) {
        return this.getNestedValue(this.config, path);
    }
    
    // 获取嵌套值
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }
    
    // 设置配置值
    set(path, value) {
        this.setNestedValue(this.config, path, value);
    }
    
    // 设置嵌套值
    setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            if (!current[key]) current[key] = {};
            return current[key];
        }, obj);
        target[lastKey] = value;
    }
    
    // 获取环境特定配置
    getEnvironmentConfig() {
        const env = process.env.NODE_ENV || 'production';
        
        const envSpecific = {
            development: {
                database: {
                    master: {
                        max: 5,
                        min: 2
                    }
                },
                cache: {
                    maxMemorySize: 100
                },
                monitoring: {
                    logging: {
                        level: 'debug'
                    }
                }
            },
            
            test: {
                database: {
                    master: {
                        max: 2,
                        min: 1
                    }
                },
                cache: {
                    maxMemorySize: 50
                },
                external: {
                    telegram: {
                        botToken: 'test-bot-token'
                    }
                }
            },
            
            production: {
                monitoring: {
                    logging: {
                        level: 'warn'
                    }
                }
            }
        };
        
        return envSpecific[env] || {};
    }
    
    // 合并环境配置
    mergeEnvironmentConfig() {
        const envConfig = this.getEnvironmentConfig();
        this.config = this.deepMerge(this.config, envConfig);
    }
    
    // 深度合并对象
    deepMerge(target, source) {
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                if (!target[key]) target[key] = {};
                this.deepMerge(target[key], source[key]);
            } else {
                target[key] = source[key];
            }
        }
        return target;
    }
    
    // 导出配置到文件
    exportConfig(filePath) {
        const configToExport = {
            ...this.config,
            // 移除敏感信息
            database: {
                ...this.config.database,
                master: {
                    ...this.config.database.master,
                    password: '[REDACTED]'
                }
            },
            redis: {
                ...this.config.redis,
                password: '[REDACTED]'
            },
            security: {
                ...this.config.security,
                jwt: {
                    ...this.config.security.jwt,
                    secret: '[REDACTED]'
                }
            }
        };
        
        fs.writeFileSync(filePath, JSON.stringify(configToExport, null, 2));
        console.log(`✅ Configuration exported to: ${filePath}`);
    }
    
    // 获取所有配置
    getAll() {
        return this.config;
    }
}

// 单例模式
let instance = null;

function getConfig() {
    if (!instance) {
        instance = new EnterpriseConfig();
        instance.mergeEnvironmentConfig();
    }
    return instance;
}

module.exports = {
    EnterpriseConfig,
    getConfig
}; 