/**
 * 多租户管理系统 - 企业级SaaS核心
 * 支持租户隔离、智能路由、限流控制、计费统计
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class MultiTenantManager extends EventEmitter {
    constructor(connectionPool, cacheManager) {
        super();
        this.connectionPool = connectionPool;
        this.cacheManager = cacheManager;
        this.tenantCache = new Map();
        this.rateLimiters = new Map();
        
        this.initializeManager();
    }
    
    // 初始化管理器
    async initializeManager() {
        console.log('🏢 初始化多租户管理系统...');
        
        try {
            // 预加载活跃租户
            await this.preloadActiveTenants();
            
            // 启动定时任务
            this.startPeriodicTasks();
            
            console.log('✅ 多租户管理系统初始化完成');
            
        } catch (error) {
            console.error('❌ 多租户管理系统初始化失败:', error);
            throw error;
        }
    }
    
    // 预加载活跃租户
    async preloadActiveTenants() {
        try {
            const query = `
                SELECT id, name, domain, plan_type, status, 
                       max_providers, max_concurrent_users, max_api_calls_per_hour,
                       bot_token, channel_id, custom_domain
                FROM tenants 
                WHERE status = 'active'
                ORDER BY created_at DESC
                LIMIT 1000
            `;
            
            const result = await this.connectionPool.executeQuery(query);
            
            for (const tenant of result.rows) {
                this.tenantCache.set(tenant.id, {
                    ...tenant,
                    loadedAt: Date.now()
                });
            }
            
            console.log(`✅ 预加载 ${result.rows.length} 个活跃租户`);
            
        } catch (error) {
            console.error('❌ 预加载租户失败:', error);
        }
    }
    
    // 智能租户识别
    async identifyTenant(req) {
        try {
            // 方式1: 子域名识别
            const subdomain = this.extractSubdomain(req.hostname);
            if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
                const tenant = await this.getTenantByDomain(subdomain);
                if (tenant) {
                    return { tenant, method: 'subdomain' };
                }
            }
            
            // 方式2: API Key识别
            const apiKey = req.headers['x-api-key'];
            if (apiKey) {
                const tenant = await this.getTenantByApiKey(apiKey);
                if (tenant) {
                    return { tenant, method: 'apikey' };
                }
            }
            
            // 方式3: 自定义域名识别
            const tenant = await this.getTenantByCustomDomain(req.hostname);
            if (tenant) {
                return { tenant, method: 'custom_domain' };
            }
            
            throw new Error('无法识别租户');
            
        } catch (error) {
            console.error('❌ 租户识别失败:', error);
            throw error;
        }
    }
    
    // 提取子域名
    extractSubdomain(hostname) {
        if (!hostname) return null;
        const parts = hostname.split('.');
        return parts.length >= 3 ? parts[0] : null;
    }
    
    // 通过域名获取租户
    async getTenantByDomain(domain) {
        const cacheKey = `tenant:domain:${domain}`;
        
        const cached = await this.cacheManager.get(cacheKey, 'system');
        if (cached.data) {
            return cached.data;
        }
        
        try {
            const query = `
                SELECT * FROM tenants 
                WHERE domain = $1 AND status = 'active'
                LIMIT 1
            `;
            
            const result = await this.connectionPool.executeQuery(query, [domain]);
            
            if (result.rows.length > 0) {
                const tenant = result.rows[0];
                await this.cacheManager.set(cacheKey, tenant, 'system', 300);
                return tenant;
            }
            
            return null;
            
        } catch (error) {
            console.error(`❌ 通过域名获取租户失败: ${domain}`, error);
            return null;
        }
    }
    
    // 通过API Key获取租户
    async getTenantByApiKey(apiKey) {
        const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
        const cacheKey = `tenant:apikey:${hashedKey}`;
        
        const cached = await this.cacheManager.get(cacheKey, 'system');
        if (cached.data) {
            return cached.data;
        }
        
        try {
            // 首先创建API Keys表
            await this.ensureApiKeysTable();
            
            const query = `
                SELECT t.* FROM tenants t
                JOIN tenant_api_keys tak ON t.id = tak.tenant_id
                WHERE tak.key_hash = $1 AND tak.is_active = true AND t.status = 'active'
                LIMIT 1
            `;
            
            const result = await this.connectionPool.executeQuery(query, [hashedKey]);
            
            if (result.rows.length > 0) {
                const tenant = result.rows[0];
                await this.cacheManager.set(cacheKey, tenant, 'system', 60);
                return tenant;
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ 通过API Key获取租户失败:', error);
            return null;
        }
    }
    
    // 通过自定义域名获取租户
    async getTenantByCustomDomain(domain) {
        const cacheKey = `tenant:custom_domain:${domain}`;
        
        const cached = await this.cacheManager.get(cacheKey, 'system');
        if (cached.data) {
            return cached.data;
        }
        
        try {
            const query = `
                SELECT * FROM tenants 
                WHERE custom_domain = $1 AND status = 'active'
                LIMIT 1
            `;
            
            const result = await this.connectionPool.executeQuery(query, [domain]);
            
            if (result.rows.length > 0) {
                const tenant = result.rows[0];
                await this.cacheManager.set(cacheKey, tenant, 'system', 600);
                return tenant;
            }
            
            return null;
            
        } catch (error) {
            console.error(`❌ 通过自定义域名获取租户失败: ${domain}`, error);
            return null;
        }
    }
    
    // 租户级别限流
    async checkRateLimit(tenantId, operation = 'api_call') {
        try {
            const tenant = await this.getTenantById(tenantId);
            if (!tenant) {
                throw new Error(`租户不存在: ${tenantId}`);
            }
            
            let limit;
            switch (operation) {
                case 'api_call':
                    limit = tenant.max_api_calls_per_hour || 1000;
                    break;
                case 'concurrent_users':
                    limit = tenant.max_concurrent_users || 100;
                    break;
                default:
                    limit = 100;
            }
            
            const usage = await this.getCurrentUsage(tenantId, operation);
            
            if (usage >= limit) {
                this.emit('rateLimitExceeded', {
                    tenantId,
                    operation,
                    limit,
                    usage
                });
                
                return {
                    allowed: false,
                    limit,
                    remaining: 0,
                    resetTime: this.getResetTime()
                };
            }
            
            await this.incrementUsage(tenantId, operation);
            
            return {
                allowed: true,
                limit,
                remaining: limit - usage - 1,
                resetTime: this.getResetTime()
            };
            
        } catch (error) {
            console.error(`❌ 限流检查失败: ${tenantId}/${operation}`, error);
            return {
                allowed: false,
                limit: 0,
                remaining: 0,
                error: error.message
            };
        }
    }
    
    // 获取当前使用量
    async getCurrentUsage(tenantId, operation) {
        const now = new Date();
        const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
        
        try {
            const query = `
                SELECT COALESCE(SUM(
                    CASE 
                        WHEN $3 = 'api_call' THEN api_calls_total
                        WHEN $3 = 'concurrent_users' THEN active_users
                        ELSE 0
                    END
                ), 0) as usage
                FROM usage_statistics
                WHERE tenant_id = $1 
                  AND stat_date = $2::date
                  AND stat_hour = EXTRACT(hour FROM $2::timestamp)
            `;
            
            const result = await this.connectionPool.executeQuery(query, [
                tenantId,
                currentHour.toISOString(),
                operation
            ]);
            
            return parseInt(result.rows[0]?.usage || 0);
            
        } catch (error) {
            console.error(`❌ 获取使用量失败: ${tenantId}/${operation}`, error);
            return 0;
        }
    }
    
    // 增加使用量
    async incrementUsage(tenantId, operation, increment = 1) {
        const now = new Date();
        const statDate = now.toISOString().split('T')[0];
        const statHour = now.getHours();
        
        try {
            const query = `
                INSERT INTO usage_statistics (
                    tenant_id, stat_date, stat_hour,
                    api_calls_total, active_users
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (tenant_id, stat_date, stat_hour)
                DO UPDATE SET
                    api_calls_total = usage_statistics.api_calls_total + $4,
                    active_users = GREATEST(usage_statistics.active_users, $5)
            `;
            
            const apiCalls = operation === 'api_call' ? increment : 0;
            const activeUsers = operation === 'concurrent_users' ? increment : 0;
            
            await this.connectionPool.executeQuery(query, [
                tenantId,
                statDate,
                statHour,
                apiCalls,
                activeUsers
            ]);
            
        } catch (error) {
            console.error(`❌ 增加使用量失败: ${tenantId}/${operation}`, error);
        }
    }
    
    // 获取重置时间
    getResetTime() {
        const now = new Date();
        const resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0);
        return Math.floor(resetTime.getTime() / 1000);
    }
    
    // 通过ID获取租户
    async getTenantById(tenantId) {
        if (this.tenantCache.has(tenantId)) {
            const cached = this.tenantCache.get(tenantId);
            if (Date.now() - cached.loadedAt < 300000) { // 5分钟缓存
                return cached;
            }
        }
        
        const cacheKey = `tenant:id:${tenantId}`;
        const cached = await this.cacheManager.get(cacheKey, 'system');
        if (cached.data) {
            this.tenantCache.set(tenantId, {
                ...cached.data,
                loadedAt: Date.now()
            });
            return cached.data;
        }
        
        try {
            const query = `
                SELECT * FROM tenants 
                WHERE id = $1 AND status = 'active'
                LIMIT 1
            `;
            
            const result = await this.connectionPool.executeQuery(query, [tenantId]);
            
            if (result.rows.length > 0) {
                const tenant = result.rows[0];
                await this.cacheManager.set(cacheKey, tenant, 'system', 300);
                this.tenantCache.set(tenantId, {
                    ...tenant,
                    loadedAt: Date.now()
                });
                return tenant;
            }
            
            return null;
            
        } catch (error) {
            console.error(`❌ 通过ID获取租户失败: ${tenantId}`, error);
            return null;
        }
    }
    
    // 创建新租户
    async createTenant(tenantData) {
        try {
            const tenantId = crypto.randomUUID();
            const now = new Date().toISOString();
            
            const query = `
                INSERT INTO tenants (
                    id, name, domain, plan_type, status,
                    max_providers, max_concurrent_users, max_api_calls_per_hour,
                    bot_token, channel_id, custom_domain,
                    created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING *
            `;
            
            const values = [
                tenantId,
                tenantData.name,
                tenantData.domain,
                tenantData.plan_type || 'basic',
                tenantData.status || 'trial',
                tenantData.max_providers || 5,
                tenantData.max_concurrent_users || 100,
                tenantData.max_api_calls_per_hour || 1000,
                tenantData.bot_token,
                tenantData.channel_id,
                tenantData.custom_domain,
                now,
                now
            ];
            
            const result = await this.connectionPool.executeQuery(query, values);
            const newTenant = result.rows[0];
            
            // 创建默认API Key
            await this.createTenantApiKey(tenantId, 'default');
            
            console.log(`✅ 新租户创建成功: ${newTenant.name} (${tenantId})`);
            
            this.emit('tenantCreated', newTenant);
            
            return newTenant;
            
        } catch (error) {
            console.error('❌ 创建租户失败:', error);
            throw error;
        }
    }
    
    // 确保API Keys表存在
    async ensureApiKeysTable() {
        try {
            const query = `
                CREATE TABLE IF NOT EXISTS tenant_api_keys (
                    id BIGSERIAL PRIMARY KEY,
                    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    key_name VARCHAR(100) NOT NULL,
                    key_hash VARCHAR(64) NOT NULL,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_used_at TIMESTAMP,
                    UNIQUE(tenant_id, key_name),
                    INDEX idx_key_hash (key_hash),
                    INDEX idx_tenant_active (tenant_id, is_active)
                )
            `;
            
            await this.connectionPool.executeQuery(query);
            
        } catch (error) {
            console.error('❌ 创建API Keys表失败:', error);
        }
    }
    
    // 为租户创建API Key
    async createTenantApiKey(tenantId, keyName = 'default') {
        try {
            await this.ensureApiKeysTable();
            
            const apiKey = this.generateApiKey();
            const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
            
            const query = `
                INSERT INTO tenant_api_keys (
                    tenant_id, key_name, key_hash, is_active, created_at
                ) VALUES ($1, $2, $3, true, $4)
                RETURNING id
            `;
            
            await this.connectionPool.executeQuery(query, [
                tenantId,
                keyName,
                hashedKey,
                new Date().toISOString()
            ]);
            
            console.log(`✅ API Key创建成功: 租户${tenantId}`);
            
            return apiKey;
            
        } catch (error) {
            console.error(`❌ 创建API Key失败: ${tenantId}`, error);
            throw error;
        }
    }
    
    // 生成API Key
    generateApiKey() {
        const prefix = 'tk_';
        const randomBytes = crypto.randomBytes(32);
        return prefix + randomBytes.toString('hex');
    }
    
    // 启动定时任务
    startPeriodicTasks() {
        // 每小时清理过期数据
        setInterval(async () => {
            try {
                // 清理30天前的使用统计
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - 30);
                
                const query = `
                    DELETE FROM usage_statistics 
                    WHERE stat_date < $1
                `;
                
                const result = await this.connectionPool.executeQuery(query, [
                    cutoffDate.toISOString().split('T')[0]
                ]);
                
                if (result.rowCount > 0) {
                    console.log(`🧹 清理过期使用统计: ${result.rowCount}条记录`);
                }
                
            } catch (error) {
                console.error('❌ 定时清理失败:', error);
            }
        }, 3600000); // 每小时
    }
    
    // 获取租户统计
    async getTenantStats(tenantId, days = 7) {
        try {
            const query = `
                SELECT 
                    stat_date,
                    SUM(api_calls_total) as total_api_calls,
                    MAX(active_users) as peak_users,
                    SUM(new_bookings) as total_bookings
                FROM usage_statistics
                WHERE tenant_id = $1 
                  AND stat_date >= CURRENT_DATE - INTERVAL '${days} days'
                GROUP BY stat_date
                ORDER BY stat_date DESC
            `;
            
            const result = await this.connectionPool.executeQuery(query, [tenantId]);
            return result.rows;
            
        } catch (error) {
            console.error(`❌ 获取租户统计失败: ${tenantId}`, error);
            return [];
        }
    }
    
    // 获取管理器状态
    getManagerStatus() {
        return {
            cachedTenants: this.tenantCache.size,
            rateLimiters: this.rateLimiters.size
        };
    }
}

module.exports = MultiTenantManager; 