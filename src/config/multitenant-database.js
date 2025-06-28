const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

// 初始化多租户数据库
function initMultiTenantDatabase() {
    try {
        // 确保数据目录存在
        const dbDir = process.env.DB_PATH || './data';
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        const dbPath = path.join(dbDir, 'multitenant_bot.db');
        console.log(`📦 连接数据库: ${dbPath}`);
        
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('temp_store = MEMORY');
        db.pragma('mmap_size = 268435456'); // 256MB
        
        createTables();
        seedDefaultData();
        
        console.log('✅ 多租户数据库初始化成功');
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
        throw error;
    }
}

// 创建数据表
function createTables() {
    // 用户表
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE NOT NULL,
            channel_id TEXT,
            username TEXT,
            full_name TEXT,
            bot_token TEXT,
            bot_username TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // 用户服务提供者表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            price INTEGER DEFAULT 2500,
            images TEXT, -- JSON array of image URLs
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, provider_id)
        )
    `);
    
    // 用户排班表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            date TEXT NOT NULL,
            hour INTEGER NOT NULL,
            status TEXT DEFAULT 'available', -- available, booked, rest, full
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, provider_id, date, hour)
        )
    `);
    
    // 用户设置表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            setting_key TEXT NOT NULL,
            setting_value TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, setting_key)
        )
    `);
    
    // 预约记录表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            customer_username TEXT,
            date TEXT NOT NULL,
            hour INTEGER NOT NULL,
            status TEXT DEFAULT 'pending', -- pending, confirmed, cancelled
            message_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    console.log('✅ 数据表创建完成');
}

// 初始化默认数据
function seedDefaultData() {
    const checkData = db.prepare('SELECT COUNT(*) as count FROM user_providers').get();
    if (checkData.count > 0) {
        console.log('ℹ️  数据已存在，跳过初始化');
        return;
    }
    
    console.log('🌱 初始化默认数据...');
    // 这里不需要默认数据，用户会自己创建
}

// 获取数据库实例
function getDatabase() {
    if (!db) {
        throw new Error('数据库未初始化');
    }
    return db;
}

// 关闭数据库连接
function closeDatabase() {
    if (db) {
        console.log('🔒 关闭数据库连接...');
        db.close();
        db = null;
    }
}

// 用户相关操作
class UserManager {
    static createUser(userData) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO users 
            (user_id, channel_id, username, full_name, bot_token, bot_username, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        return stmt.run(
            userData.user_id,
            userData.channel_id,
            userData.username,
            userData.full_name,
            userData.bot_token,
            userData.bot_username
        );
    }
    
    static getUser(userId) {
        const stmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
        return stmt.get(userId);
    }
    
    static getAllUsers() {
        const stmt = db.prepare('SELECT * FROM users WHERE status = "active"');
        return stmt.all();
    }
    
    static updateUser(userId, updateData) {
        const fields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updateData);
        values.push(userId);
        
        const stmt = db.prepare(`
            UPDATE users 
            SET ${fields}, updated_at = CURRENT_TIMESTAMP 
            WHERE user_id = ?
        `);
        
        return stmt.run(...values);
    }
}

// 服务提供者相关操作
class ProviderManager {
    static createProvider(userId, providerData) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO user_providers 
            (user_id, provider_id, name, description, price, images, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        return stmt.run(
            userId,
            providerData.provider_id,
            providerData.name,
            providerData.description,
            providerData.price || 2500,
            JSON.stringify(providerData.images || [])
        );
    }
    
    static getUserProviders(userId) {
        const stmt = db.prepare(`
            SELECT * FROM user_providers 
            WHERE user_id = ? AND status = 'active'
            ORDER BY name
        `);
        return stmt.all(userId);
    }
    
    static getProvider(userId, providerId) {
        const stmt = db.prepare(`
            SELECT * FROM user_providers 
            WHERE user_id = ? AND provider_id = ?
        `);
        return stmt.get(userId, providerId);
    }
}

// 排班相关操作
class ScheduleManager {
    static updateSchedule(userId, providerId, date, hour, status) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO user_schedules 
            (user_id, provider_id, date, hour, status, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        return stmt.run(userId, providerId, date, hour, status);
    }
    
    static getSchedule(userId, providerId, startDate, endDate) {
        const stmt = db.prepare(`
            SELECT * FROM user_schedules 
            WHERE user_id = ? AND provider_id = ? 
            AND date >= ? AND date <= ?
            ORDER BY date, hour
        `);
        return stmt.all(userId, providerId, startDate, endDate);
    }
    
    static getScheduleByDate(userId, providerId, date) {
        const stmt = db.prepare(`
            SELECT * FROM user_schedules 
            WHERE user_id = ? AND provider_id = ? AND date = ?
            ORDER BY hour
        `);
        return stmt.all(userId, providerId, date);
    }
}

// 预约相关操作
class BookingManager {
    static createBooking(bookingData) {
        const stmt = db.prepare(`
            INSERT INTO user_bookings 
            (user_id, provider_id, customer_id, customer_username, date, hour, message_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(
            bookingData.user_id,
            bookingData.provider_id,
            bookingData.customer_id,
            bookingData.customer_username,
            bookingData.date,
            bookingData.hour,
            bookingData.message_id
        );
    }
    
    static getUserBookings(userId, status = null) {
        let sql = `
            SELECT b.*, p.name as provider_name 
            FROM user_bookings b
            JOIN user_providers p ON b.user_id = p.user_id AND b.provider_id = p.provider_id
            WHERE b.user_id = ?
        `;
        
        if (status) {
            sql += ` AND b.status = ?`;
            const stmt = db.prepare(sql + ' ORDER BY b.date, b.hour');
            return stmt.all(userId, status);
        } else {
            const stmt = db.prepare(sql + ' ORDER BY b.date, b.hour');
            return stmt.all(userId);
        }
    }
}

module.exports = {
    initMultiTenantDatabase,
    getDatabase,
    closeDatabase,
    UserManager,
    ProviderManager,
    ScheduleManager,
    BookingManager
}; 