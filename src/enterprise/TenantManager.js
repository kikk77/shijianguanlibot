/**
 * 多租户管理系统
 * 支持租户隔离、智能路由、限流控制、计费统计
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class TenantManager extends EventEmitter {
    constructor(connectionPool, cacheManager) {
        super();
        this.connectionPool = connectionPool;
        this.cacheManager = cacheManager;
        this.tenantCache = new Map();
        this.rateLimiters = new Map();
        this.usageTrackers = new Map();
        
        this.initializeManager();
    }
    
    // 初始化管理器
    async initializeManager() {
        console.log('🏢 初始化多租户管理系统...');
        
        try {
            // 预加载活跃租户信息
            await this.preloadActiveTenants();
            
            // 启动使用统计定时任务
            this.startUsageTracking();
            
            // 启动限流清理任务
            this.startRateLimitCleanup();
            
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
    
    // 基于多种方式识别租户
    async identifyTenant(req) {
        try {
            // 方式1: 子域名识别 (subdomain.yourdomain.com)
            const subdomain = this.extractSubdomain(req.hostname);
            if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
                const tenant = await this.getTenantByDomain(subdomain);
                if (tenant) {
                    return { tenant, identifyMethod: 'subdomain' };
                }
            }
            
            // 方式2: API Key识别
            const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
            if (apiKey) {
                const tenant = await this.getTenantByApiKey(apiKey);
                if (tenant) {
                    return { tenant, identifyMethod: 'apikey' };
                }
            }
            
            // 方式3: 自定义域名识别
            const customDomain = req.hostname;
            if (customDomain) {
                const tenant = await this.getTenantByCustomDomain(customDomain);
                if (tenant) {
                    return { tenant, identifyMethod: 'custom_domain' };
                }
            }
            
            // 方式4: 路径参数识别 (/tenant/{tenantId}/api/...)
            const pathTenantId = this.extractTenantFromPath(req.path);
            if (pathTenantId) {
                const tenant = await this.getTenantById(pathTenantId);
                if (tenant) {
                    return { tenant, identifyMethod: 'path_param' };
                }
            }
            
            // 方式5: JWT Token识别
            const token = req.headers.authorization?.replace('Bearer ', '');
            if (token && this.isJWT(token)) {
                const tenant = await this.getTenantByJWT(token);
                if (tenant) {
                    return { tenant, identifyMethod: 'jwt' };
                }
            }
            
            throw new Error('无法识别租户');
            
        } catch (error) {
            console.error('❌ 租户识别失败:', error);
            this.emit('tenantIdentificationFailed', {
                hostname: req.hostname,
                headers: req.headers,
                path: req.path,
                error: error.message
            });
            throw error;
        }
    }
    
    // 提取子域名
    extractSubdomain(hostname) {
        if (!hostname) return null;
        
        const parts = hostname.split('.');
        if (parts.length < 3) return null;
        
        return parts[0];
    }
    
    // 从路径提取租户ID
    extractTenantFromPath(path) {
        const match = path.match(/^\/tenant\/([a-f0-9-]{36})/);
        return match ? match[1] : null;
    }
    
    // 判断是否为JWT
    isJWT(token) {
        return token && token.split('.').length === 3;
    }
    
    // 通过域名获取租户
    async getTenantByDomain(domain) {
        const cacheKey = `tenant:domain:${domain}`;
        
        // 检查缓存
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
                
                // 缓存租户信息
                await this.cacheManager.set(cacheKey, tenant, 'system', 300);
                this.tenantCache.set(tenant.id, tenant);
                
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
        
        // 检查缓存
        const cached = await this.cacheManager.get(cacheKey, 'system');
        if (cached.data) {
            return cached.data;
        }
        
        try {
            const query = `
                SELECT t.* FROM tenants t
                JOIN tenant_api_keys tak ON t.id = tak.tenant_id
                WHERE tak.key_hash = $1 AND tak.is_active = true AND t.status = 'active'
                LIMIT 1
            `;
            
            const result = await this.connectionPool.executeQuery(query, [hashedKey]);
            
            if (result.rows.length > 0) {
                const tenant = result.rows[0];
                
                // 缓存租户信息（较短过期时间，因为API Key可能会被撤销）
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
        
        // 检查缓存
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
                
                // 缓存租户信息
                await this.cacheManager.set(cacheKey, tenant, 'system', 600);
                
                return tenant;
            }
            
            return null;
            
        } catch (error) {
            console.error(`❌ 通过自定义域名获取租户失败: ${domain}`, error);
            return null;
        }
    }
    
    // 通过ID获取租户
    async getTenantById(tenantId) {
        // 检查内存缓存
        if (this.tenantCache.has(tenantId)) {
            const cached = this.tenantCache.get(tenantId);
            
            // 检查缓存是否过期（5分钟）
            if (Date.now() - cached.loadedAt < 300000) {
                return cached;
            }
        }
        
        const cacheKey = `tenant:id:${tenantId}`;
        
        // 检查Redis缓存
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
                
                // 双层缓存
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
    
    // JWT解析获取租户
    async getTenantByJWT(token) {
        try {
            // 这里应该使用实际的JWT库来验证和解析token
            // 示例代码，实际使用时需要验证签名
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            
            if (payload.tenantId) {
                return await this.getTenantById(payload.tenantId);
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ JWT解析失败:', error);
            return null;
        }
    }
    
    // 租户级别限流检查
    async checkRateLimit(tenantId, operation = 'api_call', customLimit = null) {
        const limitKey = `${tenantId}:${operation}`;
        
        try {
            // 获取租户信息
            const tenant = await this.getTenantById(tenantId);
            if (!tenant) {
                throw new Error(`租户不存在: ${tenantId}`);
            }
            
            // 确定限制值
            let limit;
            if (customLimit) {
                limit = customLimit;
            } else {
                switch (operation) {
                    case 'api_call':
                        limit = tenant.max_api_calls_per_hour || 1000;
                        break;
                    case 'concurrent_users':
                        limit = tenant.max_concurrent_users || 100;
                        break;
                    default:
                        limit = 100; // 默认限制
                }
            }
            
            // 检查当前使用量
            const usage = await this.getCurrentUsage(tenantId, operation);
            
            if (usage >= limit) {
                this.emit('rateLimitExceeded', {
                    tenantId,
                    operation,
                    limit,
                    usage,
                    timestamp: Date.now()
                });
                
                return {
                    allowed: false,
                    limit,
                    remaining: 0,
                    resetTime: this.getResetTime(),
                    retryAfter: 3600 // 1小时后重试
                };
            }
            
            // 增加使用量
            await this.incrementUsage(tenantId, operation);
            
            return {
                allowed: true,
                limit,
                remaining: limit - usage - 1,
                resetTime: this.getResetTime()
            };
            
        } catch (error) {
            console.error(`❌ 限流检查失败: ${tenantId}/${operation}`, error);
            
            // 限流检查失败时，采用保守策略（拒绝请求）
            return {
                allowed: false,
                limit: 0,
                remaining: 0,
                resetTime: this.getResetTime(),
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
                  AND stat_hour = $2::time::hour
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
    
    // 获取租户功能配置
    async getTenantFeatures(tenantId) {
        const cacheKey = `tenant:features:${tenantId}`;
        
        // 检查缓存
        const cached = await this.cacheManager.get(cacheKey, 'system');
        if (cached.data) {
            return cached.data;
        }
        
        try {
            const query = `
                SELECT feature_name, is_enabled, config_json, limits_json
                FROM tenant_features
                WHERE tenant_id = $1 AND is_enabled = true
            `;
            
            const result = await this.connectionPool.executeQuery(query, [tenantId]);
            
            const features = {};
            result.rows.forEach(row => {
                features[row.feature_name] = {
                    enabled: row.is_enabled,
                    config: row.config_json ? JSON.parse(row.config_json) : {},
                    limits: row.limits_json ? JSON.parse(row.limits_json) : {}
                };
            });
            
            // 缓存功能配置
            await this.cacheManager.set(cacheKey, features, 'system', 600);
            
            return features;
            
        } catch (error) {
            console.error(`❌ 获取租户功能配置失败: ${tenantId}`, error);
            return {};
        }
    }
    
    // 验证租户功能权限
    async checkFeaturePermission(tenantId, featureName, action = 'use') {
        try {
            const features = await this.getTenantFeatures(tenantId);
            const feature = features[featureName];
            
            if (!feature || !feature.enabled) {
                return {
                    allowed: false,
                    reason: 'Feature not enabled'
                };
            }
            
            // 检查功能限制
            if (feature.limits && feature.limits[action]) {
                const currentUsage = await this.getFeatureUsage(tenantId, featureName, action);
                const limit = feature.limits[action];
                
                if (currentUsage >= limit) {
                    return {
                        allowed: false,
                        reason: 'Feature limit exceeded',
                        limit,
                        usage: currentUsage
                    };
                }
            }
            
            return {
                allowed: true,
                config: feature.config
            };
            
        } catch (error) {
            console.error(`❌ 验证功能权限失败: ${tenantId}/${featureName}`, error);
            return {
                allowed: false,
                reason: 'Permission check failed',
                error: error.message
            };
        }
    }
    
    // 获取功能使用量
    async getFeatureUsage(tenantId, featureName, action) {
        // 这里可以根据具体需求实现功能使用量统计
        // 例如从数据库或缓存中获取使用量
        return 0;
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
            
            // 清除相关缓存
            await this.invalidateTenantCache(tenantId);
            
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
    
    // 为租户创建API Key
    async createTenantApiKey(tenantId, keyName = 'default') {
        try {
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
            
            return apiKey; // 只在创建时返回明文API Key
            
        } catch (error) {
            console.error(`❌ 创建API Key失败: ${tenantId}`, error);
            throw error;
        }
    }
    
    // 生成API Key
    generateApiKey() {
        const prefix = 'tk_'; // tenant key prefix
        const randomBytes = crypto.randomBytes(32);
        return prefix + randomBytes.toString('hex');
    }
    
    // 使用统计定时任务
    startUsageTracking() {
        setInterval(async () => {
            try {
                // 清理过期的使用统计数据（保留30天）
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
                console.error('❌ 使用统计清理失败:', error);
            }
        }, 3600000); // 每小时执行一次
    }
    
    // 限流数据清理
    startRateLimitCleanup() {
        setInterval(() => {
            // 清理过期的限流数据
            const now = Date.now();
            for (const [key, data] of this.rateLimiters.entries()) {
                if (now - data.lastAccess > 3600000) { // 1小时未访问
                    this.rateLimiters.delete(key);
                }
            }
        }, 600000); // 每10分钟清理一次
    }
    
    // 失效租户缓存
    async invalidateTenantCache(tenantId) {
        // 删除内存缓存
        this.tenantCache.delete(tenantId);
        
        // 删除Redis缓存
        await this.cacheManager.deletePattern(`tenant:*:${tenantId}*`, 'system');
        await this.cacheManager.deletePattern(`tenant:features:${tenantId}`, 'system');
    }
    
    // 获取租户统计信息
    async getTenantStats(tenantId, days = 7) {
        try {
            const query = `
                SELECT 
                    stat_date,
                    SUM(api_calls_total) as total_api_calls,
                    MAX(active_users) as peak_users,
                    SUM(new_bookings) as total_bookings,
                    AVG(storage_used_mb) as avg_storage_used
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
            rateLimiters: this.rateLimiters.size,
            usageTrackers: this.usageTrackers.size
        };
    }
}

module.exports = TenantManager; 