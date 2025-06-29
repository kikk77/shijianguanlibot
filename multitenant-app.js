require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

// 导入多租户数据库配置
const { 
    initMultiTenantDatabase, 
    UserManager, 
    ProviderManager, 
    ScheduleManager,
    BookingManager 
} = require('./src/config/multitenant-database');

// 导入机器人相关组件
const OfficialBot = require('./src/bot/official-bot');
const TelegramScheduleManager = require('./src/bot/schedule-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// 全局变量
let officialBot = null;
let scheduleManager = null;

// 中间件配置
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
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
        console.log('🚀 正在启动多租户Telegram频道管理系统...');
        
        // 1. 初始化多租户数据库
        console.log('📦 初始化多租户数据库...');
        await initMultiTenantDatabase();
        
        // 2. 启动官方机器人
        const botToken = process.env.OFFICIAL_BOT_TOKEN || process.env.BOT_TOKEN;
        if (botToken) {
            console.log('🤖 启动官方管理机器人...');
            try {
                officialBot = new OfficialBot(botToken);
                scheduleManager = new TelegramScheduleManager(officialBot.bot);
                
                // 扩展官方机器人的回调处理
                extendOfficialBot();
                
                console.log('✅ 官方机器人启动成功');
            } catch (botError) {
                console.error('❌ 官方机器人启动失败:', botError.message);
                console.log('⚠️  系统将以纯API模式运行');
                officialBot = null;
                scheduleManager = null;
            }
        } else {
            console.log('⚠️  未配置官方机器人Token (OFFICIAL_BOT_TOKEN 或 BOT_TOKEN)');
            console.log('⚠️  系统将以纯API模式运行');
        }
        
        // 3. 设置API路由
        console.log('🔧 设置API路由...');
        setupAPI();
        
        // 4. 添加基础路由
        setupBasicRoutes();
        
        // 5. 启动HTTP服务器
        app.listen(PORT, () => {
            const currentBotToken = process.env.OFFICIAL_BOT_TOKEN || process.env.BOT_TOKEN;
            console.log('');
            console.log('🎉 ================================');
            console.log('🎉  多租户系统启动成功！');
            console.log('🎉 ================================');
            console.log(`🌐 HTTP服务: http://localhost:${PORT}`);
            console.log(`🔧 API地址: http://localhost:${PORT}/api/`);
            console.log(`💾 数据库: ${process.env.DB_PATH || './data'}/multitenant_bot.db`);
            console.log(`🤖 官方机器人: ${currentBotToken ? '已启动' : '未配置'}`);
            console.log(`👥 支持用户数: 1000+`);
            console.log('🎉 ================================');
            console.log('');
        });
        
    } catch (error) {
        console.error('❌ 应用启动失败:', error);
        process.exit(1);
    }
}

// 扩展官方机器人的回调处理
function extendOfficialBot() {
    if (!officialBot) {
        console.log('⚠️  officialBot 为 null，跳过扩展功能');
        return;
    }
    
    // 添加服务提供者面板方法
    officialBot.showProvidersPanel = showProvidersPanel;
    
    const originalHandleCallback = officialBot.handleCallback.bind(officialBot);
    
    officialBot.handleCallback = async function(callbackQuery) {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id.toString();
        const data = callbackQuery.data;
        
        // 确认回调
        await this.bot.answerCallbackQuery(callbackQuery.id);
        
        try {
            // 处理排班相关回调
            if (data.startsWith('schedule_')) {
                await handleScheduleCallback(chatId, userId, data);
                return;
            }
            
            // 处理服务提供者相关回调
            if (data.startsWith('provider_')) {
                await handleProviderCallback(chatId, userId, data);
                return;
            }
            
            // 其他回调交给原始处理器，确保this上下文正确
            await originalHandleCallback.call(this, callbackQuery);
            
        } catch (error) {
            console.error('处理回调失败:', error);
            console.error('错误详情:', error.stack);
            await this.bot.sendMessage(chatId, '❌ 操作失败，请稍后重试');
        }
    };
}

// 处理排班相关回调
async function handleScheduleCallback(chatId, userId, data) {
    const parts = data.split('_');
    const action = parts[1];
    const providerId = parts[2];
    
    switch (action) {
        case 'manage':
            await scheduleManager.showProviderSchedule(chatId, userId, providerId);
            break;
            
        case 'day':
            const dateStr = parts[3];
            await scheduleManager.showDaySchedule(chatId, userId, providerId, dateStr);
            break;
            
        case 'time':
            const timeDate = parts[3];
            const hour = parts[4];
            await scheduleManager.handleTimeClick(chatId, userId, providerId, timeDate, hour);
            break;
            
        case 'dayop':
            const opDate = parts[3];
            const operation = parts[4];
            await scheduleManager.handleDayOperation(chatId, userId, providerId, opDate, operation);
            break;
            
        case 'text':
            await scheduleManager.generateChannelText(chatId, userId, providerId);
            break;
            
        case 'sync':
            await scheduleManager.syncToChannel(chatId, userId, providerId);
            break;
            
        default:
            if (officialBot) {
                await officialBot.bot.sendMessage(chatId, '❌ 未知操作');
            }
            break;
    }
}

// 处理服务提供者相关回调
async function handleProviderCallback(chatId, userId, data) {
    const parts = data.split('_');
    const action = parts[1];
    
    switch (action) {
        case 'add':
            await showAddProviderForm(chatId, userId);
            break;
            
        case 'edit':
            const providerId = parts[2];
            await showEditProviderForm(chatId, userId, providerId);
            break;
            
        case 'delete':
            const delProviderId = parts[2];
            await deleteProvider(chatId, userId, delProviderId);
            break;
            
        default:
            if (officialBot) {
                await officialBot.bot.sendMessage(chatId, '❌ 未知操作');
            }
            break;
    }
}

// 显示服务提供者管理面板
async function showProvidersPanel(chatId, userId) {
    const providers = ProviderManager.getUserProviders(userId);
    
    let panelText = `👥 <b>服务提供者管理</b>\n\n`;
    
    if (providers.length === 0) {
        panelText += `暂无服务提供者\n\n请添加第一个服务提供者：`;
    } else {
        panelText += `<b>当前服务：</b>\n`;
        providers.forEach((provider, index) => {
            panelText += `${index + 1}. ${provider.name} - ${provider.price}p\n`;
        });
        panelText += `\n<b>管理选项：</b>`;
    }
    
    const keyboard = { inline_keyboard: [] };
    
    // 添加服务提供者按钮
    keyboard.inline_keyboard.push([
        { text: '➕ 添加服务', callback_data: 'provider_add' }
    ]);
    
    // 现有服务提供者管理按钮
    if (providers.length > 0) {
        providers.forEach(provider => {
            keyboard.inline_keyboard.push([
                { text: `✏️ ${provider.name}`, callback_data: `provider_edit_${provider.provider_id}` },
                { text: `🗑️ 删除`, callback_data: `provider_delete_${provider.provider_id}` }
            ]);
        });
    }
    
    keyboard.inline_keyboard.push([
        { text: '⬅️ 返回主面板', callback_data: 'action_panel' }
    ]);
    
    if (officialBot) {
        await officialBot.bot.sendMessage(chatId, panelText, {
            parse_mode: 'HTML',
            reply_markup: JSON.stringify(keyboard)
        });
    }
}

// 扩展官方机器人的服务提供者面板方法将在机器人初始化后设置

// 设置API路由
function setupAPI() {
    
    // 用户管理API
    app.get('/api/users', (req, res) => {
        try {
            const users = UserManager.getAllUsers();
            res.json({
                success: true,
                users: users,
                total: users.length
            });
        } catch (error) {
            console.error('获取用户列表失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    app.post('/api/users', (req, res) => {
        try {
            const userData = req.body;
            const result = UserManager.createUser(userData);
            
            res.json({
                success: true,
                message: '用户创建成功',
                userId: userData.user_id
            });
        } catch (error) {
            console.error('创建用户失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // 服务提供者管理API
    app.get('/api/users/:userId/providers', (req, res) => {
        try {
            const { userId } = req.params;
            const providers = ProviderManager.getUserProviders(userId);
            
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
    
    app.post('/api/users/:userId/providers', (req, res) => {
        try {
            const { userId } = req.params;
            const providerData = req.body;
            
            const result = ProviderManager.createProvider(userId, providerData);
            
            res.json({
                success: true,
                message: '服务提供者创建成功',
                provider: providerData
            });
        } catch (error) {
            console.error('创建服务提供者失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // 排班管理API
    app.get('/api/users/:userId/providers/:providerId/schedule', (req, res) => {
        try {
            const { userId, providerId } = req.params;
            const { startDate, endDate } = req.query;
            
            const schedules = ScheduleManager.getSchedule(userId, providerId, startDate, endDate);
            
            res.json({
                success: true,
                schedules: schedules
            });
        } catch (error) {
            console.error('获取排班失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    app.post('/api/users/:userId/providers/:providerId/schedule', (req, res) => {
        try {
            const { userId, providerId } = req.params;
            const { date, hour, status } = req.body;
            
            const result = ScheduleManager.updateSchedule(userId, providerId, date, hour, status);
            
            res.json({
                success: true,
                message: '排班更新成功'
            });
        } catch (error) {
            console.error('更新排班失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // 预约管理API
    app.get('/api/users/:userId/bookings', (req, res) => {
        try {
            const { userId } = req.params;
            const { status } = req.query;
            
            const bookings = BookingManager.getUserBookings(userId, status);
            
            res.json({
                success: true,
                bookings: bookings
            });
        } catch (error) {
            console.error('获取预约失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    app.post('/api/users/:userId/bookings', (req, res) => {
        try {
            const { userId } = req.params;
            const bookingData = { ...req.body, user_id: userId };
            
            const result = BookingManager.createBooking(bookingData);
            
            res.json({
                success: true,
                message: '预约创建成功',
                bookingId: result.lastInsertRowid
            });
        } catch (error) {
            console.error('创建预约失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // 健康检查API
    app.get('/api/health', (req, res) => {
        const healthStatus = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: {
                database: 'ok',
                bot: officialBot ? 'ok' : 'not_configured',
                scheduler: scheduleManager ? 'ok' : 'not_configured'
            },
            version: '2.0.0',
            environment: process.env.NODE_ENV || 'development'
        };
        
        res.json(healthStatus);
    });

    // 生成频道文本API
    app.get('/api/users/:userId/providers/:providerId/channel-text', (req, res) => {
        try {
            const { userId, providerId } = req.params;
            
            const provider = ProviderManager.getProvider(userId, providerId);
            if (!provider) {
                return res.status(404).json({
                    success: false,
                    error: '服务提供者不存在'
                });
            }
            
            // 获取未来7天排班
            const dates = [];
            const today = new Date();
            for (let i = 0; i < 7; i++) {
                const date = new Date(today);
                date.setDate(today.getDate() + i);
                dates.push(date);
            }
            
            const startDate = dates[0].toISOString().split('T')[0];
            const endDate = dates[6].toISOString().split('T')[0];
            const schedules = ScheduleManager.getSchedule(userId, providerId, startDate, endDate);
            
            // 生成频道文本
            let channelText = `【${provider.name}】${provider.price}p\n\n`;
            
            for (const date of dates) {
                const dateStr = date.toISOString().split('T')[0];
                const dayNum = date.getDate();
                
                const daySlots = [];
                for (let hour = 10; hour <= 22; hour++) {
                    const schedule = schedules.find(s => s.date === dateStr && s.hour === hour);
                    if (!schedule || schedule.status === 'available') {
                        daySlots.push(hour);
                    }
                }
                
                if (daySlots.length === 0) {
                    const allBooked = schedules.filter(s => s.date === dateStr && s.status === 'booked').length === 13;
                    channelText += `${dayNum}号 ${allBooked ? '满' : '休息'}\n`;
                } else {
                    const timeSlots = daySlots.map(hour => hour.toString()).join('/');
                    channelText += `${dayNum}号 ${timeSlots}\n`;
                }
            }
            
            channelText += `\n点击预约 👇`;
            
            res.json({
                success: true,
                channelText: channelText,
                provider: provider
            });
            
        } catch (error) {
            console.error('生成频道文本失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
}

// 设置基础路由
function setupBasicRoutes() {
    
    // 健康检查
    app.get('/health', (req, res) => {
        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            environment: process.env.NODE_ENV || 'development',
            features: {
                multiTenant: true,
                officialBot: !!process.env.OFFICIAL_BOT_TOKEN,
                maxUsers: 1000
            }
        });
    });
    
    // 根路径重定向到系统信息
    app.get('/', (req, res) => {
        res.json({
            name: '多租户Telegram频道管理系统',
            version: '2.0.0',
            description: '支持1000个用户独立管理时间表的Telegram机器人系统',
            features: [
                '多租户数据隔离',
                '官方机器人注册管理',
                '移动端内联键盘操作',
                '自动频道同步',
                'Railway一键部署'
            ],
            endpoints: {
                '/api/users': '用户管理',
                '/api/users/:userId/providers': '服务提供者管理',
                '/api/users/:userId/bookings': '预约管理',
                '/health': '健康检查'
            }
        });
    });
    
    // API文档
    app.get('/api', (req, res) => {
        res.json({
            name: '多租户Telegram频道管理系统API',
            version: '2.0.0',
            baseURL: '/api',
            endpoints: {
                'GET /users': '获取所有用户',
                'POST /users': '创建用户',
                'GET /users/:userId/providers': '获取用户的服务提供者',
                'POST /users/:userId/providers': '创建服务提供者',
                'GET /users/:userId/providers/:providerId/schedule': '获取排班',
                'POST /users/:userId/providers/:providerId/schedule': '更新排班',
                'GET /users/:userId/bookings': '获取预约',
                'POST /users/:userId/bookings': '创建预约',
                'GET /users/:userId/providers/:providerId/channel-text': '生成频道文本'
            }
        });
    });
    
    // 统计信息
    app.get('/api/stats', (req, res) => {
        try {
            const users = UserManager.getAllUsers();
            const totalProviders = users.reduce((sum, user) => {
                return sum + ProviderManager.getUserProviders(user.user_id).length;
            }, 0);
            
            res.json({
                success: true,
                stats: {
                    totalUsers: users.length,
                    activeUsers: users.filter(u => u.status === 'active').length,
                    totalProviders: totalProviders,
                    systemUptime: process.uptime(),
                    memoryUsage: process.memoryUsage()
                }
            });
        } catch (error) {
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
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
    console.log('🔄 收到关闭信号，正在优雅关闭...');
    
    try {
        // 关闭机器人
        if (officialBot && officialBot.bot) {
            officialBot.bot.stopPolling();
            console.log('✅ 官方机器人已停止');
        }
        
        // 关闭数据库
        const { closeDatabase } = require('./src/config/multitenant-database');
        closeDatabase();
        console.log('✅ 数据库连接已关闭');
        
        console.log('✅ 系统已安全关闭');
        process.exit(0);
    } catch (error) {
        console.error('❌ 关闭过程中出错:', error);
        process.exit(1);
    }
}

// 启动应用
startApplication(); 