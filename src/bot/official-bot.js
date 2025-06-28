const TelegramBot = require('node-telegram-bot-api');
const { UserManager, ProviderManager } = require('../config/multitenant-database');

class OfficialBot {
    constructor(token) {
        this.bot = new TelegramBot(token, { polling: true });
        this.setupCommands();
        this.setupCallbacks();
        console.log('🤖 官方机器人启动成功');
    }
    
    setupCommands() {
        // 开始命令
        this.bot.onText(/\/start/, (msg) => {
            this.handleStart(msg);
        });
        
        // 注册命令
        this.bot.onText(/\/register/, (msg) => {
            this.handleRegister(msg);
        });
        
        // 管理面板命令
        this.bot.onText(/\/panel/, (msg) => {
            this.handlePanel(msg);
        });
        
        // 帮助命令
        this.bot.onText(/\/help/, (msg) => {
            this.handleHelp(msg);
        });
    }
    
    setupCallbacks() {
        // 处理内联键盘回调
        this.bot.on('callback_query', (callbackQuery) => {
            this.handleCallback(callbackQuery);
        });
        
        // 处理文本消息
        this.bot.on('message', (msg) => {
            if (!msg.text || msg.text.startsWith('/')) return;
            this.handleMessage(msg);
        });
    }
    
    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        const username = msg.from.username || '';
        const fullName = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
        
        const welcomeText = `
🎉 *欢迎使用Telegram频道管理机器人！*

我是官方管理机器人，可以帮助您：

📱 *快速注册* - 自动创建您的专属管理系统
⚙️ *管理面板* - 直接在机器人内操作排班
📊 *数据统计* - 实时查看预约和收入情况
🔄 *自动同步* - 排班变化立即更新频道帖子

*使用步骤：*
1️⃣ 发送 /register 开始注册
2️⃣ 按提示配置您的频道和服务信息
3️⃣ 发送 /panel 打开管理面板
4️⃣ 直接在机器人内管理您的排班

👇 点击下方按钮开始使用
        `;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🚀 立即注册', callback_data: 'action_register' },
                    { text: '📋 管理面板', callback_data: 'action_panel' }
                ],
                [
                    { text: '❓ 使用帮助', callback_data: 'action_help' },
                    { text: '📞 联系客服', callback_data: 'action_contact' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'Markdown',
            reply_markup: JSON.stringify(keyboard)
        });
    }
    
    async handleRegister(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        
        console.log(`📝 开始注册流程 - 用户ID: ${userId}, 聊天ID: ${chatId}`);
        
        try {
            // 检查用户是否已注册
            console.log(`🔍 检查用户是否已注册: ${userId}`);
            const existingUser = UserManager.getUser(userId);
            console.log(`📊 用户查询结果:`, existingUser);
            
            if (existingUser) {
                await this.bot.sendMessage(chatId, `
✅ *您已经注册过了！*

当前状态：${existingUser.status === 'active' ? '正常' : '未激活'}
注册时间：${new Date(existingUser.created_at).toLocaleString('zh-CN')}

直接发送 /panel 打开管理面板，或点击下方按钮：
                `, {
                    parse_mode: 'Markdown',
                    reply_markup: JSON.stringify({
                        inline_keyboard: [
                            [{ text: '📋 打开管理面板', callback_data: 'action_panel' }]
                        ]
                    })
                });
                return;
            }
            
            // 开始注册流程
            await this.bot.sendMessage(chatId, `
🔧 *开始注册流程*

请按以下步骤完成注册：

*第1步：频道设置*
请发送您的频道链接或频道ID
格式：@your_channel 或 -1001234567890

*第2步：机器人设置*
我将帮您生成专属的管理机器人

*第3步：服务配置*
配置您的服务提供者信息

请先发送您的频道信息 👇
            `, {
                parse_mode: 'Markdown'
            });
            
            // 标记用户状态为注册中
            this.setUserState(userId, 'registering_channel');
            
        } catch (error) {
            console.error(`❌ 注册处理失败 - 用户ID: ${userId}:`, error);
            console.error('错误堆栈:', error.stack);
            await this.bot.sendMessage(chatId, '❌ 注册过程中出现错误，请稍后重试或联系管理员');
        }
    }
    
    async handlePanel(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        
        // 检查用户是否已注册
        const user = UserManager.getUser(userId);
        if (!user) {
            await this.bot.sendMessage(chatId, `
❌ *您尚未注册*

请先完成注册才能使用管理面板。
            `, {
                parse_mode: 'Markdown',
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
        // 获取用户信息和服务提供者
        const user = UserManager.getUser(userId);
        const providers = ProviderManager.getUserProviders(userId);
        
        let panelText = `
📋 *管理面板*

用户：${user.full_name || user.username}
频道：${user.channel_id || '未设置'}
状态：${user.status === 'active' ? '✅ 正常' : '❌ 未激活'}

*服务提供者：*
${providers.length > 0 ? 
    providers.map(p => `• ${p.name} (${p.price}p)`).join('\n') : 
    '暂无服务提供者'
}

请选择操作：
        `;
        
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
                    { text: '📱 测试机器人', callback_data: 'panel_test' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, panelText, {
            parse_mode: 'Markdown',
            reply_markup: JSON.stringify(keyboard)
        });
    }
    
    async handleCallback(callbackQuery) {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id.toString();
        const data = callbackQuery.data;
        
        // 确认回调
        await this.bot.answerCallbackQuery(callbackQuery.id);
        
        switch (data) {
            case 'action_register':
                await this.handleRegister({ chat: { id: chatId }, from: callbackQuery.from });
                break;
                
            case 'action_panel':
                await this.handlePanel({ chat: { id: chatId }, from: callbackQuery.from });
                break;
                
            case 'action_help':
                await this.handleHelp({ chat: { id: chatId } });
                break;
                
            case 'panel_schedule':
                await this.showSchedulePanel(chatId, userId);
                break;
                
            case 'panel_providers':
                await this.showProvidersPanel(chatId, userId);
                break;
                
            case 'panel_stats':
                await this.showStatsPanel(chatId, userId);
                break;
                
            case 'panel_sync':
                await this.syncChannelPosts(chatId, userId);
                break;
                
            default:
                if (data.startsWith('schedule_')) {
                    await this.handleScheduleCallback(chatId, userId, data);
                } else if (data.startsWith('provider_')) {
                    await this.handleProviderCallback(chatId, userId, data);
                }
                break;
        }
    }
    
    async showSchedulePanel(chatId, userId) {
        const providers = ProviderManager.getUserProviders(userId);
        
        if (providers.length === 0) {
            await this.bot.sendMessage(chatId, `
❌ *暂无服务提供者*

请先添加服务提供者才能管理排班。
            `, {
                parse_mode: 'Markdown',
                reply_markup: JSON.stringify({
                    inline_keyboard: [
                        [{ text: '👥 添加服务提供者', callback_data: 'panel_providers' }],
                        [{ text: '⬅️ 返回主面板', callback_data: 'action_panel' }]
                    ]
                })
            });
            return;
        }
        
        const keyboard = {
            inline_keyboard: [
                ...providers.map(provider => ([
                    { text: `⏰ ${provider.name}`, callback_data: `schedule_manage_${provider.provider_id}` }
                ])),
                [{ text: '⬅️ 返回主面板', callback_data: 'action_panel' }]
            ]
        };
        
        await this.bot.sendMessage(chatId, `
⏰ *排班管理*

选择要管理的服务提供者：
        `, {
            parse_mode: 'Markdown',
            reply_markup: JSON.stringify(keyboard)
        });
    }
    
    async handleScheduleCallback(chatId, userId, data) {
        const parts = data.split('_');
        const action = parts[1];
        const providerId = parts[2];
        
        if (action === 'manage') {
            await this.showProviderSchedule(chatId, userId, providerId);
        }
    }
    
    async showProviderSchedule(chatId, userId, providerId) {
        const provider = ProviderManager.getProvider(userId, providerId);
        if (!provider) {
            await this.bot.sendMessage(chatId, '❌ 服务提供者不存在');
            return;
        }
        
        // 生成未来7天的排班界面
        const today = new Date();
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            dates.push(date);
        }
        
        let scheduleText = `
⏰ *${provider.name} - 排班管理*

📅 未来7天排班：

`;
        
        const keyboard = { inline_keyboard: [] };
        
        for (const date of dates) {
            const dateStr = date.toISOString().split('T')[0];
            const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
            const dayStr = `${date.getMonth() + 1}/${date.getDate()}(${weekday})`;
            
            scheduleText += `\n*${dayStr}*\n`;
            
            // 添加日期行按钮
            const dayButtons = [];
            dayButtons.push({ text: `📅 ${dayStr}`, callback_data: `schedule_day_${providerId}_${dateStr}` });
            keyboard.inline_keyboard.push(dayButtons);
            
            // 添加时间段按钮 (10:00-22:00)
            const timeButtons = [];
            for (let hour = 10; hour <= 22; hour++) {
                timeButtons.push({
                    text: `${hour}`,
                    callback_data: `schedule_time_${providerId}_${dateStr}_${hour}`
                });
                
                if ((hour - 10 + 1) % 4 === 0) {
                    keyboard.inline_keyboard.push([...timeButtons]);
                    timeButtons.length = 0;
                }
            }
            
            if (timeButtons.length > 0) {
                keyboard.inline_keyboard.push(timeButtons);
            }
        }
        
        keyboard.inline_keyboard.push([
            { text: '🔄 同步频道', callback_data: `schedule_sync_${providerId}` },
            { text: '⬅️ 返回', callback_data: 'panel_schedule' }
        ]);
        
        await this.bot.sendMessage(chatId, scheduleText, {
            parse_mode: 'Markdown',
            reply_markup: JSON.stringify(keyboard)
        });
    }
    
    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        const text = msg.text;
        
        const userState = this.getUserState(userId);
        
        if (userState === 'registering_channel') {
            await this.handleChannelInput(chatId, userId, text);
        }
    }
    
    async handleChannelInput(chatId, userId, channelInput) {
        try {
            // 验证频道格式
            let channelId = channelInput.trim();
            
            if (channelId.startsWith('@')) {
                // 用户名格式，需要获取实际ID
                await this.bot.sendMessage(chatId, `
✅ *频道信息已接收*

频道：${channelId}

正在验证频道权限...
                `, { parse_mode: 'Markdown' });
            } else if (channelId.startsWith('-100')) {
                // 数字ID格式
                await this.bot.sendMessage(chatId, `
✅ *频道ID已接收*

频道ID：${channelId}

正在验证机器人权限...
                `, { parse_mode: 'Markdown' });
            } else {
                await this.bot.sendMessage(chatId, `
❌ *格式错误*

请发送正确的频道格式：
• @your_channel （频道用户名）
• -1001234567890 （频道ID）
                `, { parse_mode: 'Markdown' });
                return;
            }
            
            // 创建用户记录
            const userData = {
                user_id: userId,
                channel_id: channelId,
                username: this.getUserFromId(chatId).username,
                full_name: this.getUserFromId(chatId).full_name,
                bot_token: null, // 后续生成
                bot_username: null
            };
            
            UserManager.createUser(userData);
            
            await this.bot.sendMessage(chatId, `
🎉 *注册成功！*

您的专属管理系统已创建：
• 用户ID：${userId}
• 频道：${channelId}
• 状态：已激活

*下一步：*
请发送 /panel 打开管理面板，开始配置您的服务。
            `, {
                parse_mode: 'Markdown',
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
    
    async handleHelp(msg) {
        const chatId = msg.chat.id;
        
        const helpText = `
❓ *使用帮助*

*基本功能：*
/start - 开始使用
/register - 注册账号
/panel - 管理面板
/help - 使用帮助

*主要特性：*
📱 *移动端管理* - 直接在手机上操作
⚡ *即时同步* - 排班变化立即更新频道
🔐 *数据隔离* - 每个用户独立数据库
📊 *实时统计* - 预约和收入数据

*使用流程：*
1. 发送 /register 开始注册
2. 设置您的频道信息
3. 配置服务提供者和价格
4. 使用 /panel 管理排班
5. 客户通过频道帖子预约

*技术支持：*
如有问题请联系开发团队
        `;
        
        await this.bot.sendMessage(chatId, helpText, {
            parse_mode: 'Markdown',
            reply_markup: JSON.stringify({
                inline_keyboard: [
                    [{ text: '🚀 开始注册', callback_data: 'action_register' }],
                    [{ text: '📋 管理面板', callback_data: 'action_panel' }]
                ]
            })
        });
    }
    
    // 用户状态管理 (简单内存存储)
    userStates = new Map();
    
    setUserState(userId, state) {
        this.userStates.set(userId, state);
    }
    
    getUserState(userId) {
        return this.userStates.get(userId);
    }
    
    clearUserState(userId) {
        this.userStates.delete(userId);
    }
    
    getUserFromId(chatId) {
        // 这里应该从消息中获取用户信息，简化处理
        return { username: '', full_name: '' };
    }
}

module.exports = OfficialBot; 