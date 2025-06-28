-- =============================================
-- Telegram频道机器人 - 企业级EAV数据库设计
-- 支持多租户、高并发、灵活属性扩展
-- =============================================

-- 租户管理表
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    domain VARCHAR(100) UNIQUE,
    plan_type ENUM('basic', 'pro', 'enterprise') NOT NULL DEFAULT 'basic',
    status ENUM('active', 'suspended', 'trial', 'expired') DEFAULT 'trial',
    
    -- 功能限制配置
    max_providers INTEGER DEFAULT 5,
    max_concurrent_users INTEGER DEFAULT 100,
    max_api_calls_per_hour INTEGER DEFAULT 1000,
    max_storage_gb INTEGER DEFAULT 1,
    
    -- Bot配置
    bot_token VARCHAR(500),
    channel_id VARCHAR(100),
    webhook_url VARCHAR(300),
    custom_domain VARCHAR(100),
    
    -- 计费信息
    billing_cycle ENUM('monthly', 'yearly') DEFAULT 'monthly',
    next_billing_date TIMESTAMP,
    total_usage_current_cycle BIGINT DEFAULT 0,
    monthly_fee DECIMAL(10,2) DEFAULT 0,
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 索引优化
    INDEX idx_status_plan (status, plan_type),
    INDEX idx_domain (domain),
    INDEX idx_created_at (created_at)
);

-- 租户功能配置表
CREATE TABLE tenant_features (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id UUID NOT NULL,
    feature_name VARCHAR(50) NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    config_json JSON,
    limits_json JSON, -- 功能限制配置
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE KEY uk_tenant_feature (tenant_id, feature_name),
    INDEX idx_tenant_enabled (tenant_id, is_enabled)
);

-- EAV核心表结构

-- 实体表（所有业务对象的基础表）
CREATE TABLE entities (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id UUID NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- provider, booking, schedule, channel_post
    entity_code VARCHAR(100) NOT NULL, -- 业务编码，租户内唯一
    parent_id BIGINT NULL, -- 支持层级关系
    status ENUM('active', 'inactive', 'deleted') DEFAULT 'active',
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 优化索引
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES entities(id) ON DELETE SET NULL,
    UNIQUE KEY uk_tenant_code (tenant_id, entity_type, entity_code),
    INDEX idx_tenant_type (tenant_id, entity_type),
    INDEX idx_entity_status (entity_type, status),
    INDEX idx_parent (parent_id),
    INDEX idx_created_at (created_at)
);

-- 属性定义表（定义各种属性的元信息）
CREATE TABLE attributes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    entity_type VARCHAR(50) NOT NULL,
    attribute_name VARCHAR(100) NOT NULL,
    attribute_display_name VARCHAR(200),
    attribute_type ENUM('string', 'text', 'number', 'decimal', 'boolean', 'datetime', 'json', 'file') NOT NULL,
    
    -- 验证规则
    is_required BOOLEAN DEFAULT FALSE,
    is_searchable BOOLEAN DEFAULT FALSE,
    is_unique BOOLEAN DEFAULT FALSE,
    max_length INTEGER,
    min_value DECIMAL(20,8),
    max_value DECIMAL(20,8),
    validation_regex VARCHAR(500),
    
    -- 默认值
    default_value_string TEXT,
    default_value_number DECIMAL(20,8),
    default_value_boolean BOOLEAN,
    default_value_json JSON,
    
    -- 显示配置
    display_order INTEGER DEFAULT 0,
    is_visible BOOLEAN DEFAULT TRUE,
    input_type VARCHAR(50), -- input, textarea, select, radio, checkbox
    options_json JSON, -- 选择项配置
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_entity_attr (entity_type, attribute_name),
    INDEX idx_entity_type (entity_type),
    INDEX idx_searchable (is_searchable),
    INDEX idx_display_order (display_order)
);

-- 实体属性值表（核心存储表）
CREATE TABLE entity_values (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    entity_id BIGINT NOT NULL,
    attribute_id BIGINT NOT NULL,
    tenant_id UUID NOT NULL, -- 冗余字段，优化查询
    
    -- 多类型值存储
    value_string TEXT,
    value_text LONGTEXT,
    value_number DECIMAL(20,8),
    value_boolean BOOLEAN,
    value_datetime TIMESTAMP NULL,
    value_json JSON,
    
    -- 搜索优化字段
    search_text TEXT, -- 用于全文搜索的预处理文本
    search_number DECIMAL(20,8), -- 用于数值范围查询
    search_keywords VARCHAR(1000), -- 关键词标签
    
    -- 版本控制
    version INTEGER DEFAULT 1,
    is_current BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (attribute_id) REFERENCES attributes(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- 核心索引（性能关键）
    UNIQUE KEY uk_entity_attr_current (entity_id, attribute_id, is_current),
    INDEX idx_tenant_search (tenant_id, attribute_id, search_text(255)),
    INDEX idx_tenant_number (tenant_id, attribute_id, search_number),
    INDEX idx_tenant_datetime (tenant_id, attribute_id, value_datetime),
    INDEX idx_search_keywords (search_keywords(255)),
    
    -- 复合索引优化
    INDEX idx_tenant_entity_attr (tenant_id, entity_id, attribute_id),
    INDEX idx_current_values (is_current, tenant_id, attribute_id)
);

-- 属性关系表（支持属性间关联）
CREATE TABLE attribute_relations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    parent_attribute_id BIGINT NOT NULL,
    child_attribute_id BIGINT NOT NULL,
    relation_type ENUM('one_to_one', 'one_to_many', 'many_to_many') NOT NULL,
    is_required BOOLEAN DEFAULT FALSE,
    
    FOREIGN KEY (parent_attribute_id) REFERENCES attributes(id) ON DELETE CASCADE,
    FOREIGN KEY (child_attribute_id) REFERENCES attributes(id) ON DELETE CASCADE,
    UNIQUE KEY uk_parent_child (parent_attribute_id, child_attribute_id)
);

-- 租户级别属性模板（预定义配置）
CREATE TABLE tenant_attribute_templates (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id UUID NOT NULL,
    template_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    template_config JSON NOT NULL, -- 完整的属性配置
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE KEY uk_tenant_template (tenant_id, template_name, entity_type)
);

-- =============================================
-- 性能优化表
-- =============================================

-- 实体搜索视图（物化视图，定期刷新）
CREATE TABLE entity_search_index (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    entity_id BIGINT NOT NULL,
    tenant_id UUID NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    
    -- 搜索字段（预聚合）
    title VARCHAR(500),
    description TEXT,
    tags VARCHAR(1000),
    searchable_content LONGTEXT,
    
    -- 常用过滤字段
    price_min DECIMAL(10,2),
    price_max DECIMAL(10,2),
    available_from TIMESTAMP,
    available_to TIMESTAMP,
    location_lat DECIMAL(10,6),
    location_lng DECIMAL(10,6),
    
    -- 统计字段
    view_count BIGINT DEFAULT 0,
    booking_count BIGINT DEFAULT 0,
    rating_avg DECIMAL(3,2) DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- 搜索优化索引
    FULLTEXT KEY ft_searchable (title, description, searchable_content),
    INDEX idx_tenant_type (tenant_id, entity_type),
    INDEX idx_price_range (price_min, price_max),
    INDEX idx_available_time (available_from, available_to),
    INDEX idx_location (location_lat, location_lng),
    INDEX idx_popularity (view_count, booking_count, rating_avg)
);

-- 使用统计表（用于分析和计费）
CREATE TABLE usage_statistics (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id UUID NOT NULL,
    stat_date DATE NOT NULL,
    stat_hour TINYINT NOT NULL, -- 0-23
    
    -- API调用统计
    api_calls_total BIGINT DEFAULT 0,
    api_calls_success BIGINT DEFAULT 0,
    api_calls_error BIGINT DEFAULT 0,
    
    -- 用户行为统计
    active_users INTEGER DEFAULT 0,
    new_bookings INTEGER DEFAULT 0,
    total_bookings INTEGER DEFAULT 0,
    
    -- 存储统计
    storage_used_mb DECIMAL(12,2) DEFAULT 0,
    bandwidth_used_mb DECIMAL(12,2) DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE KEY uk_tenant_stat_time (tenant_id, stat_date, stat_hour),
    INDEX idx_stat_date (stat_date),
    INDEX idx_tenant_date (tenant_id, stat_date)
);

-- =============================================
-- 初始化数据
-- =============================================

-- 插入基础属性定义
INSERT INTO attributes (entity_type, attribute_name, attribute_display_name, attribute_type, is_required, is_searchable) VALUES
-- 服务提供者属性
('provider', 'name', '姓名', 'string', TRUE, TRUE),
('provider', 'nickname', '艺名', 'string', FALSE, TRUE),
('provider', 'age', '年龄', 'number', FALSE, TRUE),
('provider', 'height', '身高(cm)', 'number', FALSE, TRUE),
('provider', 'weight', '体重(kg)', 'number', FALSE, TRUE),
('provider', 'bust_size', '胸围', 'string', FALSE, FALSE),
('provider', 'nationality', '国籍', 'string', FALSE, TRUE),
('provider', 'languages', '语言', 'json', FALSE, TRUE),
('provider', 'services', '服务项目', 'json', FALSE, TRUE),
('provider', 'price_range', '价格区间', 'string', FALSE, TRUE),
('provider', 'photos', '照片URLs', 'json', FALSE, FALSE),
('provider', 'description', '个人介绍', 'text', FALSE, TRUE),
('provider', 'available_hours', '可预约时间', 'json', FALSE, FALSE),
('provider', 'contact_method', '联系方式', 'string', FALSE, FALSE),

-- 预约记录属性
('booking', 'user_telegram_id', '用户ID', 'string', TRUE, FALSE),
('booking', 'user_username', '用户名', 'string', FALSE, TRUE),
('booking', 'provider_id', '服务提供者ID', 'number', TRUE, FALSE),
('booking', 'booking_date', '预约日期', 'datetime', TRUE, TRUE),
('booking', 'booking_time', '预约时间', 'string', TRUE, TRUE),
('booking', 'duration_hours', '服务时长', 'number', FALSE, FALSE),
('booking', 'total_price', '总价格', 'decimal', FALSE, TRUE),
('booking', 'payment_status', '支付状态', 'string', FALSE, TRUE),
('booking', 'booking_status', '预约状态', 'string', TRUE, TRUE),
('booking', 'customer_notes', '客户备注', 'text', FALSE, FALSE),
('booking', 'admin_notes', '管理员备注', 'text', FALSE, FALSE),

-- 频道帖子属性
('channel_post', 'message_id', '消息ID', 'string', TRUE, FALSE),
('channel_post', 'provider_id', '服务提供者ID', 'number', TRUE, FALSE),
('channel_post', 'image_urls', '图片URLs', 'json', FALSE, FALSE),
('channel_post', 'caption_text', '文字内容', 'text', FALSE, TRUE),
('channel_post', 'inline_keyboard', '内联键盘', 'json', FALSE, FALSE),
('channel_post', 'view_count', '浏览次数', 'number', FALSE, FALSE),
('channel_post', 'last_edit_time', '最后编辑时间', 'datetime', FALSE, FALSE),

-- 排班数据属性
('schedule', 'provider_id', '服务提供者ID', 'number', TRUE, FALSE),
('schedule', 'schedule_date', '排班日期', 'datetime', TRUE, TRUE),
('schedule', 'time_slots', '时间段配置', 'json', TRUE, FALSE),
('schedule', 'day_status', '当日状态', 'string', FALSE, TRUE),
('schedule', 'special_notes', '特殊说明', 'text', FALSE, FALSE);

-- 创建性能优化存储过程
DELIMITER //

-- 快速查询实体属性值
CREATE PROCEDURE GetEntityAttributes(
    IN p_tenant_id UUID,
    IN p_entity_id BIGINT
)
BEGIN
    SELECT 
        a.attribute_name,
        a.attribute_display_name,
        a.attribute_type,
        CASE a.attribute_type
            WHEN 'string' THEN ev.value_string
            WHEN 'text' THEN ev.value_text
            WHEN 'number' THEN CAST(ev.value_number AS CHAR)
            WHEN 'decimal' THEN CAST(ev.value_number AS CHAR)
            WHEN 'boolean' THEN CASE ev.value_boolean WHEN 1 THEN 'true' ELSE 'false' END
            WHEN 'datetime' THEN DATE_FORMAT(ev.value_datetime, '%Y-%m-%d %H:%i:%s')
            WHEN 'json' THEN JSON_UNQUOTE(ev.value_json)
            ELSE NULL
        END as attribute_value
    FROM entity_values ev
    JOIN attributes a ON ev.attribute_id = a.id
    WHERE ev.tenant_id = p_tenant_id 
      AND ev.entity_id = p_entity_id 
      AND ev.is_current = TRUE
    ORDER BY a.display_order, a.attribute_name;
END //

-- 批量更新实体属性
CREATE PROCEDURE UpdateEntityAttributes(
    IN p_tenant_id UUID,
    IN p_entity_id BIGINT,
    IN p_attributes JSON
)
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE attr_name VARCHAR(100);
    DECLARE attr_value TEXT;
    DECLARE attr_id BIGINT;
    DECLARE attr_type VARCHAR(50);
    DECLARE cur CURSOR FOR 
        SELECT JSON_UNQUOTE(JSON_EXTRACT(p_attributes, CONCAT('$[', idx, '].name'))),
               JSON_UNQUOTE(JSON_EXTRACT(p_attributes, CONCAT('$[', idx, '].value')))
        FROM (
            SELECT 0 as idx UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION 
            SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION 
            SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11
        ) numbers
        WHERE JSON_UNQUOTE(JSON_EXTRACT(p_attributes, CONCAT('$[', idx, '].name'))) IS NOT NULL;
    
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    
    START TRANSACTION;
    
    OPEN cur;
    
    read_loop: LOOP
        FETCH cur INTO attr_name, attr_value;
        IF done THEN
            LEAVE read_loop;
        END IF;
        
        -- 获取属性定义
        SELECT id, attribute_type INTO attr_id, attr_type
        FROM attributes a
        JOIN entities e ON a.entity_type = e.entity_type
        WHERE e.id = p_entity_id AND a.attribute_name = attr_name;
        
        IF attr_id IS NOT NULL THEN
            -- 标记旧值为非当前
            UPDATE entity_values 
            SET is_current = FALSE 
            WHERE entity_id = p_entity_id AND attribute_id = attr_id;
            
            -- 插入新值
            INSERT INTO entity_values (
                entity_id, attribute_id, tenant_id, is_current,
                value_string, value_text, value_number, 
                value_boolean, value_datetime, value_json,
                search_text, search_number
            ) VALUES (
                p_entity_id, attr_id, p_tenant_id, TRUE,
                CASE WHEN attr_type IN ('string') THEN attr_value ELSE NULL END,
                CASE WHEN attr_type = 'text' THEN attr_value ELSE NULL END,
                CASE WHEN attr_type IN ('number', 'decimal') THEN CAST(attr_value AS DECIMAL(20,8)) ELSE NULL END,
                CASE WHEN attr_type = 'boolean' THEN (attr_value = 'true' OR attr_value = '1') ELSE NULL END,
                CASE WHEN attr_type = 'datetime' THEN STR_TO_DATE(attr_value, '%Y-%m-%d %H:%i:%s') ELSE NULL END,
                CASE WHEN attr_type = 'json' THEN JSON_VALID(attr_value) ELSE NULL END,
                -- 搜索优化字段
                CASE WHEN attr_type IN ('string', 'text') THEN attr_value ELSE NULL END,
                CASE WHEN attr_type IN ('number', 'decimal') THEN CAST(attr_value AS DECIMAL(20,8)) ELSE NULL END
            );
        END IF;
        
    END LOOP;
    
    CLOSE cur;
    COMMIT;
END //

DELIMITER ;

-- 创建触发器自动更新搜索索引
DELIMITER //

CREATE TRIGGER update_search_index_after_value_change
AFTER INSERT ON entity_values
FOR EACH ROW
BEGIN
    IF NEW.is_current = TRUE THEN
        -- 更新搜索索引表
        INSERT INTO entity_search_index (
            entity_id, tenant_id, entity_type, last_updated
        )
        SELECT 
            NEW.entity_id, 
            NEW.tenant_id,
            e.entity_type,
            NOW()
        FROM entities e 
        WHERE e.id = NEW.entity_id
        ON DUPLICATE KEY UPDATE last_updated = NOW();
    END IF;
END //

DELIMITER ; 