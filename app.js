require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

// 导入数据库配置
const { initDatabase } = require('./src/config/database');

// 导入API处理器
const { setupAdminAPI } = require('./src/api/adminHandlers');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件配置
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务 (管理后台)
app.use('/', express.static(path.join(__dirname, '.')));

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'development' ? err.message : '内部服务器错误'
    });
});

// 初始化应用
async function startApplication() {
    try {
        console.log('🚀 正在启动Telegram频道管理机器人...');
        
        // 1. 初始化数据库
        console.log('📦 初始化数据库...');
        initDatabase();
        
        // 2. 设置管理员API路由
        console.log('🔧 设置API路由...');
        setupAdminAPI(app);
        
        // 3. 添加基础路由
        setupBasicRoutes();
        
        // 4. 启动HTTP服务器
        app.listen(PORT, () => {
            console.log('');
            console.log('🎉 ================================');
            console.log('🎉  应用启动成功！');
            console.log('🎉 ================================');
            console.log(`📱 管理后台: http://localhost:${PORT}/admin_prototype.html`);
            console.log(`🔧 API地址: http://localhost:${PORT}/api/`);
            console.log(`💾 数据库: ${process.env.DB_PATH || './data/bot.db'}`);
            console.log(`📺 频道ID: ${process.env.CHANNEL_ID || '未配置'}`);
            console.log(`🤖 Bot用户名: @${process.env.BOT_USERNAME || '未配置'}`);
            console.log('🎉 ================================');
            console.log('');
        });
        
    } catch (error) {
        console.error('❌ 应用启动失败:', error);
        process.exit(1);
    }
}

// 设置基础路由
function setupBasicRoutes() {
    
    // 健康检查
    app.get('/health', (req, res) => {
        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development'
        });
    });
    
    // 根路径重定向到管理后台
    app.get('/', (req, res) => {
        res.redirect('/admin_prototype.html');
    });
    
    // API文档
    app.get('/api', (req, res) => {
        res.json({
            name: 'Telegram频道管理机器人API',
            version: '1.0.0',
            endpoints: {
                'POST /api/update-channel-post': '更新频道帖子',
                'POST /api/batch-update-all-posts': '批量更新所有帖子',
                'GET /api/channel-post-status/:providerId': '获取帖子状态',
                'GET /health': '健康检查',
                'GET /': '管理后台'
            },
            documentation: '访问根路径查看管理后台'
        });
    });
    
    // 获取服务提供者列表API
    app.get('/api/providers', (req, res) => {
        try {
            const { getDatabase } = require('./src/config/database');
            const db = getDatabase();
            
            const providers = db.prepare(`
                SELECT id, name, description, status 
                FROM providers 
                WHERE status = 'active'
                ORDER BY name
            `).all();
            
            res.json({
                success: true,
                providers: providers
            });
            
        } catch (error) {
            console.error('获取服务提供者失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // 保存排班数据API
    app.post('/api/save-schedule', (req, res) => {
        try {
            const { providerId, scheduleData } = req.body;
            const { getDatabase } = require('./src/config/database');
            const db = getDatabase();
            
            // 保存排班数据到数据库
            const saveSchedule = db.prepare(`
                INSERT OR REPLACE INTO schedule_data (provider_id, date, status, available_slots, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
            const transaction = db.transaction(() => {
                Object.entries(scheduleData).forEach(([date, data]) => {
                    saveSchedule.run(
                        providerId,
                        date,
                        data.status,
                        JSON.stringify(data.slots || [])
                    );
                });
            });
            
            transaction();
            
            console.log(`✅ 排班数据已保存: 服务提供者${providerId}`);
            
            res.json({
                success: true,
                message: '排班数据保存成功'
            });
            
        } catch (error) {
            console.error('保存排班数据失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // 404处理
    app.use('*', (req, res) => {
        res.status(404).json({
            success: false,
            error: '接口不存在',
            path: req.originalUrl
        });
    });
}

// 优雅关闭处理
process.on('SIGTERM', () => {
    console.log('🔄 收到SIGTERM信号，正在优雅关闭...');
    gracefulShutdown();
});

process.on('SIGINT', () => {
    console.log('🔄 收到SIGINT信号，正在优雅关闭...');
    gracefulShutdown();
});

function gracefulShutdown() {
    try {
        const { closeDatabase } = require('./src/config/database');
        closeDatabase();
        console.log('✅ 应用已安全关闭');
        process.exit(0);
    } catch (error) {
        console.error('❌ 关闭过程中出错:', error);
        process.exit(1);
    }
}

// 启动应用
startApplication(); 