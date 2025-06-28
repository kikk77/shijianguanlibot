const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

// 初始化数据库
function initDatabase() {
    try {
        // 确保数据目录存在
        const dataDir = path.dirname(process.env.DB_PATH || './data/bot.db');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // 连接数据库
        const dbPath = process.env.DB_PATH || './data/bot.db';
        db = new Database(dbPath);
        
        // 启用外键约束
        db.pragma('foreign_keys = ON');
        
        // 创建表结构
        createTables();
        
        // 初始化默认数据
        initDefaultData();
        
        console.log('✅ 数据库初始化完成:', dbPath);
        
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
        throw error;
    }
}

// 创建数据库表
function createTables() {
    // 服务提供者表
    db.exec(`
        CREATE TABLE IF NOT EXISTS providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            avatar_url TEXT,
            description TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 时间段表
    db.exec(`
        CREATE TABLE IF NOT EXISTS time_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER,
            date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            status TEXT DEFAULT 'available',
            max_bookings INTEGER DEFAULT 1,
            current_bookings INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (provider_id) REFERENCES providers (id)
        )
    `);

    // 预约记录表
    db.exec(`
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            username TEXT,
            provider_id INTEGER,
            time_slot_id INTEGER,
            status TEXT DEFAULT 'pending',
            contact_info TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (provider_id) REFERENCES providers (id),
            FOREIGN KEY (time_slot_id) REFERENCES time_slots (id)
        )
    `);

    // 频道帖子表
    db.exec(`
        CREATE TABLE IF NOT EXISTS channel_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER,
            provider_id INTEGER,
            image_url TEXT,
            caption TEXT,
            status TEXT DEFAULT 'active',
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (provider_id) REFERENCES providers (id)
        )
    `);

    // 系统配置表
    db.exec(`
        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 排班数据表 (存储每天的时间段配置)
    db.exec(`
        CREATE TABLE IF NOT EXISTS schedule_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER,
            date TEXT NOT NULL,
            status TEXT DEFAULT 'normal',
            available_slots TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (provider_id) REFERENCES providers (id),
            UNIQUE(provider_id, date)
        )
    `);

    // 时间信息消息表 (存储发送到频道的时间信息)
    db.exec(`
        CREATE TABLE IF NOT EXISTS time_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER,
            provider_id INTEGER,
            content TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (provider_id) REFERENCES providers (id)
        )
    `);
}

// 初始化默认数据
function initDefaultData() {
    try {
        // 检查是否已有服务提供者数据
        const existingProviders = db.prepare('SELECT COUNT(*) as count FROM providers').get();
        
        if (existingProviders.count === 0) {
            console.log('🔄 初始化默认服务提供者数据...');
            
            // 插入默认服务提供者
            const insertProvider = db.prepare(`
                INSERT INTO providers (name, description, status) 
                VALUES (?, ?, ?)
            `);
            
            const providers = [
                ['示例服务者', '请在管理后台添加实际的服务提供者', 'active']
            ];
            
            providers.forEach(provider => {
                insertProvider.run(...provider);
            });
            
            console.log('✅ 默认服务提供者数据初始化完成');
        }
        
        // 初始化系统配置
        const insertConfig = db.prepare(`
            INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)
        `);
        
        insertConfig.run('bot_version', '1.0.0');
        insertConfig.run('last_update_check', new Date().toISOString());
        insertConfig.run('max_concurrent_bookings', '50');
        insertConfig.run('booking_timeout_minutes', '30');
        
    } catch (error) {
        console.error('❌ 初始化默认数据失败:', error);
    }
}

// 获取数据库实例
function getDatabase() {
    if (!db) {
        throw new Error('数据库未初始化，请先调用 initDatabase()');
    }
    return db;
}

// 关闭数据库连接
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        console.log('✅ 数据库连接已关闭');
    }
}

// 执行数据库备份
function backupDatabase() {
    try {
        const sourceDb = getDatabase();
        const backupPath = `${process.env.DB_PATH || './data/bot.db'}.backup.${Date.now()}`;
        
        sourceDb.backup(backupPath);
        console.log('✅ 数据库备份完成:', backupPath);
        return backupPath;
    } catch (error) {
        console.error('❌ 数据库备份失败:', error);
        throw error;
    }
}

// 数据库健康检查
function healthCheck() {
    try {
        const db = getDatabase();
        const result = db.prepare('SELECT 1 as test').get();
        return result.test === 1;
    } catch (error) {
        console.error('❌ 数据库健康检查失败:', error);
        return false;
    }
}

module.exports = {
    initDatabase,
    getDatabase,
    closeDatabase,
    backupDatabase,
    healthCheck
}; 