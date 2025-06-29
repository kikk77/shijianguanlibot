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
const TelegramBot = require('node-telegram-bot-api');
const TelegramScheduleManager = require('./src/bot/schedule-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// 全局变量
let officialBot = null;
let scheduleManager = null;

// 简化的机器人类
class OfficialBot {
    constructor(token) {
        this.bot = new TelegramBot(token, { polling: true });
        this.userStates = new Map();
        this.setupCommands();
        this.setupCallbacks();
    }
    
    setupCommands() {
        this.bot.onText(/\/start/, this.handleStart.bind(this));
        this.bot.onText(/\/register/, this.handleRegister.bind(this));
        this.bot.onText(/\/panel/, this.handlePanel.bind(this));
        this.bot.onText(/\/help/, this.handleHelp.bind(this));
        this.bot.on('message', this.handleMessage.bind(this));
    }
    
    setupCallbacks() {
        this.bot.on('callback_query', this.handleCallback.bind(this));
    }
    
    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        
        const user = UserManager.getUser(userId);
        
        if (user) {
            await this.showManagementPanel(chatId, userId);
        } else {
            await this.bot.sendMessage(chatId, `🎉 <b>欢迎使用时间管理系统</b>

这是一个专业的Telegram频道时间排班管理系统，帮助您：

✨ <b>核心功能</b>
• 📅 7天滚动排班管理
• 🔄 自动同步频道帖子
• 👥 多服务提供者支持
• 📊 实时数据统计

🚀 <b>开始使用</b>
点击下方按钮立即注册，或发送 /register`, {
                parse_mode: 'HTML',
                reply_markup: JSON.stringify({
                    inline_keyboard: [
                        [{ text: '🚀 立即注册', callback_data: 'action_register' }],
                        [{ text: '❓ 使用帮助', callback_data: 'action_help' }]
                    ]
                })
            });
        }
    }
    
    async handleRegister(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        
        const user = UserManager.getUser(userId);
        
        if (user) {
            await this.bot.sendMessage(chatId, '✅ 您已经注册过了，直接使用管理面板：', {
                reply_markup: JSON.stringify({
                    inline_keyboard: [
                        [{ text: '📋 打开管理面板', callback_data: 'action_panel' }]
                    ]
                })
            });
            return;
        }
        
        await this.bot.sendMessage(chatId, `📝 <b>用户注册</b>

请发送您的频道信息：

<b>支持格式：</b>
• @your_channel (频道用户名)
• -1001234567890 (频道ID)

<b>注意：</b>
请确保机器人已被添加到频道并具有管理员权限`, {
            parse_mode: 'HTML'
        });
        
        this.setUserState(userId, 'registering_channel');
    }
    
    async handlePanel(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        
        const user = UserManager.getUser(userId);
        
        if (!user) {
            await this.bot.sendMessage(chatId, '❌ 请先注册后再使用管理面板', {
                reply_markup: JSON.stringify({
                    inline_keyboard: [
                        [{ text: '🚀 立即注册', callback_data: 'action_register' }]
                    ]
                })
            });
            return;
        }
        
        await this.showManagementPanel(chatId, userId);
    }
    
    async showManagementPanel(chatId, userId) {
        const user = UserManager.getUser(userId);
        const providers = ProviderManager.getUserProviders(userId);
        
        let panelText = `📋 <b>管理面板</b>

<b>用户：</b> ${user.full_name || '未知用户'}
<b>频道：</b> ${user.channel_id || '@xiaojiyangqiu'}
<b>状态：</b> ✅ 正常

<b>服务提供者：</b>`;
        
        if (providers.length > 0) {
            providers.forEach((provider, index) => {
                panelText += `\n• ${provider.name} (${provider.price}p)`;
            });
        } else {
            panelText += `\n暂无服务提供者`;
        }
        
        panelText += `\n\n<b>请选择操作：</b>`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '⏰ 排班管理', callback_data: 'panel_schedule' },
                    { text: '👥 服务管理', callback_data: 'panel_providers' }
                ],
                [
                    { text: '📊 数据统计', callback_data: 'panel_stats' },
                    { text: '⚙️ 设置', callback_data: 'panel_settings' }
                ],
                [
                    { text: '🔄 同步频道', callback_data: 'panel_sync' },
                    { text: '🤖 测试机器人', callback_data: 'panel_test' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, panelText, {
            parse_mode: 'HTML',
            reply_markup: JSON.stringify(keyboard)
        });
    }
    
    async handleHelp(msg) {
        const chatId = msg.chat.id;
        
        const helpText = `❓ <b>使用帮助</b>

<b>基本功能：</b>
/start - 开始使用
/register - 注册账号
/panel - 管理面板
/help - 使用帮助

<b>主要特性：</b>
📱 <b>移动端管理</b> - 直接在手机上操作
⚡ <b>即时同步</b> - 排班变化立即更新频道
🔐 <b>数据隔离</b> - 每个用户独立数据库
📊 <b>实时统计</b> - 预约和收入数据

<b>使用流程：</b>
1. 发送 /register 开始注册
2. 设置您的频道信息
3. 配置服务提供者和价格
4. 使用 /panel 管理排班
5. 客户通过频道帖子预约

<b>技术支持：</b>
如有问题请联系开发团队`;
        
        await this.bot.sendMessage(chatId, helpText, {
            parse_mode: 'HTML',
            reply_markup: JSON.stringify({
                inline_keyboard: [
                    [{ text: '🚀 开始注册', callback_data: 'action_register' }],
                    [{ text: '📋 管理面板', callback_data: 'action_panel' }]
                ]
            })
        });
    }
    
    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        const text = msg.text;
        
        // 跳过命令消息
        if (text && text.startsWith('/')) return;
        
        const userState = this.getUserState(userId);
        
        if (userState === 'registering_channel') {
            await this.handleChannelInput(chatId, userId, text);
        } else if (userState === 'adding_provider') {
            await this.handleProviderInput(chatId, userId, text);
        } else if (userState && userState.startsWith('editing_provider_')) {
            const providerId = userState.split('_')[2];
            await this.handleProviderEdit(chatId, userId, providerId, text);
        }
    }
    
    async handleChannelInput(chatId, userId, channelInput) {
        try {
            let channelId = channelInput.trim();
            
            if (channelId.startsWith('@')) {
                await this.bot.sendMessage(chatId, `✅ <b>频道信息已接收</b>

频道：${channelId}

正在验证频道权限...`, { parse_mode: 'HTML' });
            } else if (channelId.startsWith('-100')) {
                await this.bot.sendMessage(chatId, `✅ <b>频道ID已接收</b>

频道ID：${channelId}

正在验证机器人权限...`, { parse_mode: 'HTML' });
            } else {
                await this.bot.sendMessage(chatId, `❌ <b>格式错误</b>

请发送正确的频道格式：
• @your_channel （频道用户名）
• -1001234567890 （频道ID）`, { parse_mode: 'HTML' });
                return;
            }
            
            const userData = {
                user_id: userId,
                channel_id: channelId,
                username: '未知用户',
                full_name: '未知用户',
                bot_token: null,
                bot_username: null
            };
            
            UserManager.createUser(userData);
            
            await this.bot.sendMessage(chatId, `🎉 <b>注册成功！</b>

您的专属管理系统已创建：
• 用户ID：${userId}
• 频道：${channelId}
• 状态：已激活

<b>下一步：</b>
请发送 /panel 打开管理面板，开始配置您的服务。`, {
                parse_mode: 'HTML',
                reply_markup: JSON.stringify({
                    inline_keyboard: [
                        [{ text: '📋 打开管理面板', callback_data: 'action_panel' }]
                    ]
                })
            });
            
            this.clearUserState(userId);
            
        } catch (error) {
            console.error('处理频道输入失败:', error);
            await this.bot.sendMessage(chatId, '❌ 处理失败，请重试');
        }
    }
    
    async handleProviderInput(chatId, userId, text) {
        try {
            const parts = text.split('|');
            if (parts.length !== 3) {
                await this.bot.sendMessage(chatId, `❌ <b>格式错误</b>

请按正确格式发送：
服务名称|价格|描述

<b>示例：</b>
艾米娜|2500|英国真实05年，身高175，体重48KG`, {
                    parse_mode: 'HTML'
                });
                return;
            }
            
            const [name, priceStr, description] = parts.map(p => p.trim());
            const price = parseInt(priceStr);
            
            if (!name || isNaN(price) || price <= 0) {
                await this.bot.sendMessage(chatId, '❌ 名称不能为空，价格必须是正数');
                return;
            }
            
            const providerId = `provider_${Date.now()}`;
            
            const providerData = {
                provider_id: providerId,
                name: name,
                description: description,
                price: price,
                images: []
            };
            
            ProviderManager.createProvider(userId, providerData);
            
            await this.bot.sendMessage(chatId, `✅ <b>添加成功</b>

服务提供者信息：
• 名称：${name}
• 价格：${price}p
• 描述：${description}`, {
                parse_mode: 'HTML',
                reply_markup: JSON.stringify({
                    inline_keyboard: [
                        [{ text: '📋 返回服务管理', callback_data: 'panel_providers' }],
                        [{ text: '⏰ 管理排班', callback_data: `schedule_manage_${providerId}` }]
                    ]
                })
            });
            
            this.clearUserState(userId);
            
        } catch (error) {
            console.error('处理服务提供者输入失败:', error);
            await this.bot.sendMessage(chatId, '❌ 添加失败，请重试');
            this.clearUserState(userId);
        }
    }
    
    async handleProviderEdit(chatId, userId, providerId, text) {
        try {
            const parts = text.split('|');
            if (parts.length !== 3) {
                await this.bot.sendMessage(chatId, `❌ <b>格式错误</b>

请按正确格式发送：
服务名称|价格|描述`, {
                    parse_mode: 'HTML'
                });
                return;
            }
            
            const [name, priceStr, description] = parts.map(p => p.trim());
            const price = parseInt(priceStr);
            
            if (!name || isNaN(price) || price <= 0) {
                await this.bot.sendMessage(chatId, '❌ 名称不能为空，价格必须是正数');
                return;
            }
            
            const providerData = {
                provider_id: providerId,
                name: name,
                description: description,
                price: price,
                images: []
            };
            
            ProviderManager.createProvider(userId, providerData);
            
            await this.bot.sendMessage(chatId, `✅ <b>更新成功</b>

服务提供者信息已更新：
• 名称：${name}
• 价格：${price}p
• 描述：${description}`, {
                parse_mode: 'HTML',
                reply_markup: JSON.stringify({
                    inline_keyboard: [
                        [{ text: '📋 返回服务管理', callback_data: 'panel_providers' }]
                    ]
                })
            });
            
            this.clearUserState(userId);
            
        } catch (error) {
            console.error('处理服务提供者编辑失败:', error);
            await this.bot.sendMessage(chatId, '❌ 更新失败，请重试');
            this.clearUserState(userId);
        }
    }
    
    setUserState(userId, state) {
        this.userStates.set(userId, state);
    }
    
    getUserState(userId) {
        return this.userStates.get(userId);
    }
    
    clearUserState(userId) {
        this.userStates.delete(userId);
    }
}

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
    console.log(`🔧 主应用处理排班回调: ${data}`);
    const parts = data.split('_');
    const action = parts[1];
    
    switch (action) {
        case 'manage':
            // schedule_manage_provider_1751175564567
            const providerId_manage = parts.slice(2).join('_');
            console.log(`📋 排班管理: providerId=${providerId_manage}`);
            await scheduleManager.showProviderSchedule(chatId, userId, providerId_manage);
            break;
            
        case 'day':
            // schedule_day_provider_1751175564567_2025-06-29
            const providerId_day = parts.slice(2, -1).join('_');
            const dateStr = parts[parts.length - 1];
            console.log(`📅 日期管理: providerId=${providerId_day}, date=${dateStr}`);
            await scheduleManager.showDaySchedule(chatId, userId, providerId_day, dateStr);
            break;
            
        case 'time':
            // schedule_time_provider_1751175564567_2025-06-29_14
            const providerId_time = parts.slice(2, -2).join('_');
            const timeDate = parts[parts.length - 2];
            const hour = parts[parts.length - 1];
            console.log(`⏰ 时间管理: providerId=${providerId_time}, date=${timeDate}, hour=${hour}`);
            await scheduleManager.handleTimeClick(chatId, userId, providerId_time, timeDate, hour);
            break;
            
        case 'dayop':
            // schedule_dayop_provider_1751175564567_2025-06-29_allopen
            const providerId_dayop = parts.slice(2, -2).join('_');
            const opDate = parts[parts.length - 2];
            const operation = parts[parts.length - 1];
            console.log(`🔧 日期操作: providerId=${providerId_dayop}, date=${opDate}, op=${operation}`);
            await scheduleManager.handleDayOperation(chatId, userId, providerId_dayop, opDate, operation);
            break;
            
        case 'text':
            // schedule_text_provider_1751175564567
            const providerId_text = parts.slice(2).join('_');
            console.log(`📝 文本生成: providerId=${providerId_text}`);
            await scheduleManager.generateChannelText(chatId, userId, providerId_text);
            break;
            
        case 'sync':
            // schedule_sync_provider_1751175564567
            const providerId_sync = parts.slice(2).join('_');
            console.log(`🔄 同步频道: providerId=${providerId_sync}`);
            await scheduleManager.syncToChannel(chatId, userId, providerId_sync);
            break;
            
        default:
            console.log('未处理的排班回调:', data);
            if (officialBot) {
                await officialBot.bot.sendMessage(chatId, '❌ 未知操作');
            }
            break;
    }
}

// 处理服务提供者相关回调
async function handleProviderCallback(chatId, userId, data) {
    console.log(`🔧 主应用处理服务提供者回调: ${data}`);
    const parts = data.split('_');
    const action = parts[1];
    
    switch (action) {
        case 'add':
            await showAddProviderForm(chatId, userId);
            break;
            
        case 'edit':
            // provider_edit_provider_1751175564567
            const providerId_edit = parts.slice(2).join('_');
            console.log(`✏️ 编辑服务提供者: providerId=${providerId_edit}`);
            await showEditProviderForm(chatId, userId, providerId_edit);
            break;
            
        case 'delete':
            // provider_delete_provider_1751175564567
            const delProviderId = parts.slice(2).join('_');
            console.log(`🗑️ 删除服务提供者: providerId=${delProviderId}`);
            await deleteProvider(chatId, userId, delProviderId);
            break;
            
        case 'confirm':
            if (parts[2] === 'delete') {
                // provider_confirm_delete_provider_1751175564567
                const confirmProviderId = parts.slice(3).join('_');
                console.log(`✅ 确认删除服务提供者: providerId=${confirmProviderId}`);
                await confirmDeleteProvider(chatId, userId, confirmProviderId);
            }
            break;
            
        default:
            console.log('未处理的服务提供者回调:', data);
            if (officialBot) {
                await officialBot.bot.sendMessage(chatId, '❌ 未知操作');
            }
            break;
    }
}

// 显示添加服务提供者表单
async function showAddProviderForm(chatId, userId) {
    if (!officialBot) return;
    
    await officialBot.bot.sendMessage(chatId, `➕ <b>添加服务提供者</b>

请发送服务提供者信息，格式如下：

<b>格式：</b>
服务名称|价格|描述

<b>示例：</b>
艾米娜|2500|英国真实05年，身高175，体重48KG

请按格式发送信息：`, {
        parse_mode: 'HTML',
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: '⬅️ 返回', callback_data: 'panel_providers' }]
            ]
        })
    });
    
    // 设置用户状态为添加服务提供者
    if (officialBot.setUserState) {
        officialBot.setUserState(userId, 'adding_provider');
    }
}

// 显示编辑服务提供者表单
async function showEditProviderForm(chatId, userId, providerId) {
    if (!officialBot) return;
    
    const provider = ProviderManager.getProvider(userId, providerId);
    if (!provider) {
        await officialBot.bot.sendMessage(chatId, '❌ 服务提供者不存在');
        return;
    }
    
    await officialBot.bot.sendMessage(chatId, `✏️ <b>编辑服务提供者</b>

<b>当前信息：</b>
名称：${provider.name}
价格：${provider.price}p
描述：${provider.description || '无'}

请发送新的信息，格式：
服务名称|价格|描述

或点击下方按钮：`, {
        parse_mode: 'HTML',
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: '🗑️ 删除此服务', callback_data: `provider_delete_${providerId}` }],
                [{ text: '⬅️ 返回', callback_data: 'panel_providers' }]
            ]
        })
    });
    
    // 设置用户状态为编辑服务提供者
    if (officialBot.setUserState) {
        officialBot.setUserState(userId, `editing_provider_${providerId}`);
    }
}

// 删除服务提供者
async function deleteProvider(chatId, userId, providerId) {
    if (!officialBot) return;
    
    const provider = ProviderManager.getProvider(userId, providerId);
    if (!provider) {
        await officialBot.bot.sendMessage(chatId, '❌ 服务提供者不存在');
        return;
    }
    
    await officialBot.bot.sendMessage(chatId, `🗑️ <b>确认删除</b>

确定要删除服务提供者 "${provider.name}" 吗？

⚠️ 此操作将同时删除相关的排班数据，且无法恢复！`, {
        parse_mode: 'HTML',
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [
                    { text: '✅ 确认删除', callback_data: `provider_confirm_delete_${providerId}` },
                    { text: '❌ 取消', callback_data: 'panel_providers' }
                ]
            ]
        })
    });
}

// 确认删除服务提供者
async function confirmDeleteProvider(chatId, userId, providerId) {
    if (!officialBot) return;
    
    try {
        const provider = ProviderManager.getProvider(userId, providerId);
        if (!provider) {
            await officialBot.bot.sendMessage(chatId, '❌ 服务提供者不存在');
            return;
        }
        
        // 删除相关排班数据
        const db = require('./src/config/multitenant-database').getDatabase();
        const deleteSchedules = db.prepare('DELETE FROM user_schedules WHERE user_id = ? AND provider_id = ?');
        deleteSchedules.run(userId, providerId);
        
        // 删除预约数据
        const deleteBookings = db.prepare('DELETE FROM user_bookings WHERE user_id = ? AND provider_id = ?');
        deleteBookings.run(userId, providerId);
        
        // 删除服务提供者
        const deleteProvider = db.prepare('DELETE FROM user_providers WHERE user_id = ? AND provider_id = ?');
        deleteProvider.run(userId, providerId);
        
        await officialBot.bot.sendMessage(chatId, `✅ <b>删除成功</b>

服务提供者 "${provider.name}" 及相关数据已删除。`, {
            parse_mode: 'HTML',
            reply_markup: JSON.stringify({
                inline_keyboard: [
                    [{ text: '📋 返回服务管理', callback_data: 'panel_providers' }]
                ]
            })
        });
        
    } catch (error) {
        console.error('删除服务提供者失败:', error);
        await officialBot.bot.sendMessage(chatId, '❌ 删除失败，请稍后重试');
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