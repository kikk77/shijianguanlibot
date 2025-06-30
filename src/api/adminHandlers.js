const TelegramBot = require('node-telegram-bot-api');
const { getDatabase } = require('../config/database');

// 初始化Bot
const bot = new TelegramBot(process.env.BOT_TOKEN);

// 设置管理员API路由
const setupAdminAPI = (app) => {
    
    // 📤 发送时间信息到频道的API
    app.post('/api/send-time-message', async (req, res) => {
        try {
            const { providerId, providerName, scheduleData } = req.body;
            
            console.log(`📤 收到时间信息发送请求: ${providerName}`);
            
            // 验证必需参数
            if (!providerId || !providerName || !scheduleData) {
                return res.status(400).json({
                    success: false,
                    error: '缺少必需参数'
                });
            }
            
            // 生成时间信息内容
            const timeMessage = generateTimeMessage(providerName, scheduleData);
            
            // 获取频道配置
            const channelId = process.env.CHANNEL_ID;
            if (!channelId) {
                throw new Error('未配置频道ID');
            }
            
            // 尝试删除上一条时间信息
            const db = getDatabase();
            const lastTimeMessage = db.prepare(`
                SELECT message_id FROM time_messages 
                WHERE provider_id = ? AND status = 'active' 
                ORDER BY id DESC LIMIT 1
            `).get(providerId);
            
            if (lastTimeMessage && lastTimeMessage.message_id) {
                try {
                    await bot.deleteMessage(channelId, lastTimeMessage.message_id);
                    console.log(`🗑️ 已删除旧时间消息: ${lastTimeMessage.message_id}`);
                    
                    // 标记为已删除
                    db.prepare(`
                        UPDATE time_messages 
                        SET status = 'deleted' 
                        WHERE message_id = ?
                    `).run(lastTimeMessage.message_id);
                    
                } catch (deleteError) {
                    console.log(`⚠️ 删除旧消息失败: ${deleteError.message}`);
                }
            }
            
            // 发送新的时间信息
            const message = await bot.sendMessage(channelId, timeMessage, {
                parse_mode: 'HTML'
            });
            
            // 保存新的时间消息记录
            db.prepare(`
                INSERT INTO time_messages 
                (message_id, provider_id, content, status, created_at)
                VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)
            `).run(message.message_id, providerId, timeMessage);
            
            console.log(`✅ 时间信息发送成功: ${message.message_id}`);
            
            res.json({
                success: true,
                messageId: message.message_id,
                channelId: channelId,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ 发送时间信息失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 📊 获取统计数据API
    app.get('/api/get-stats', async (req, res) => {
        try {
            const db = getDatabase();
            
            // 获取总预约数
            const totalBookings = db.prepare(`
                SELECT COUNT(*) as count FROM bookings
            `).get().count;
            
            // 获取待确认预约数
            const pendingBookings = db.prepare(`
                SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'
            `).get().count;
            
            // 获取今日预约数
            const todayBookings = db.prepare(`
                SELECT COUNT(*) as count FROM bookings 
                WHERE date(created_at) = date('now')
            `).get().count;
            
            // 计算可用时段数
            let availableSlots = 0;
            const scheduleData = db.prepare(`
                SELECT * FROM schedule_data 
                WHERE date >= date('now') 
                ORDER BY date
            `).all();
            
            scheduleData.forEach(data => {
                if (data.status === 'normal' && data.available_slots) {
                    const slots = JSON.parse(data.available_slots);
                    availableSlots += slots.length;
                }
            });
            
            res.json({
                success: true,
                stats: {
                    totalBookings,
                    pendingBookings,
                    todayBookings,
                    availableSlots
                }
            });
            
        } catch (error) {
            console.error('❌ 获取统计数据失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 👥 获取服务提供者列表API
    app.get('/api/get-providers', async (req, res) => {
        try {
            const db = getDatabase();
            const providers = db.prepare(`
                SELECT id, name, description, status, created_at 
                FROM providers 
                ORDER BY name
            `).all();
            
            res.json({
                success: true,
                providers: providers
            });
            
        } catch (error) {
            console.error('❌ 获取服务提供者失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // ➕ 添加服务提供者API
    app.post('/api/add-provider', async (req, res) => {
        try {
            const { name, description } = req.body;
            
            if (!name) {
                return res.status(400).json({
                    success: false,
                    error: '服务者姓名不能为空'
                });
            }
            
            const db = getDatabase();
            
            // 检查是否重名
            const existing = db.prepare(`
                SELECT id FROM providers WHERE name = ?
            `).get(name);
            
            if (existing) {
                return res.status(400).json({
                    success: false,
                    error: '服务者姓名已存在'
                });
            }
            
            // 插入新服务者
            const result = db.prepare(`
                INSERT INTO providers (name, description, status)
                VALUES (?, ?, 'active')
            `).run(name, description || '');
            
            console.log(`✅ 添加服务者成功: ${name}`);
            
            res.json({
                success: true,
                providerId: result.lastInsertRowid,
                message: `服务者 "${name}" 添加成功！`
            });
            
        } catch (error) {
            console.error('❌ 添加服务者失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 📅 获取排班数据API
    app.get('/api/get-schedule-data/:providerId', async (req, res) => {
        try {
            const { providerId } = req.params;
            const db = getDatabase();
            
            // 获取未来7天的排班数据
            const scheduleData = db.prepare(`
                SELECT date, status, available_slots 
                FROM schedule_data 
                WHERE provider_id = ? AND date >= date('now')
                ORDER BY date
                LIMIT 7
            `).all(providerId);
            
            // 转换为前端需要的格式
            const formattedData = {};
            
            // 生成未来7天的日期
            for (let i = 0; i < 7; i++) {
                const date = new Date();
                date.setDate(date.getDate() + i);
                const dateStr = date.toISOString().split('T')[0];
                
                const existing = scheduleData.find(d => d.date === dateStr);
                
                if (existing) {
                    formattedData[dateStr] = {
                        status: existing.status,
                        slots: existing.available_slots ? JSON.parse(existing.available_slots) : []
                    };
                } else {
                    // 默认数据
                    formattedData[dateStr] = {
                        status: 'normal',
                        slots: [17, 18, 19]
                    };
                }
            }
            
            res.json({
                success: true,
                scheduleData: formattedData
            });
            
        } catch (error) {
            console.error('❌ 获取排班数据失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 🔄 更新排班数据API
    app.post('/api/update-schedule', async (req, res) => {
        try {
            const { providerId, date, status, slots } = req.body;
            
            if (!providerId || !date || !status) {
                return res.status(400).json({
                    success: false,
                    error: '缺少必需参数'
                });
            }
            
            const db = getDatabase();
            
            // 保存排班数据
            db.prepare(`
                INSERT OR REPLACE INTO schedule_data 
                (provider_id, date, status, available_slots, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(providerId, date, status, JSON.stringify(slots || []));
            
            console.log(`✅ 更新排班数据: 提供者${providerId} - ${date} - ${status}`);
            
            res.json({
                success: true,
                message: '排班数据更新成功'
            });
            
        } catch (error) {
            console.error('❌ 更新排班数据失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 🗑️ 删除服务提供者API (需要管理员密码)
    app.delete('/api/delete-provider', async (req, res) => {
        try {
            const { providerId, adminPassword } = req.body;
            
            if (!providerId || !adminPassword) {
                return res.status(400).json({
                    success: false,
                    error: '缺少必需参数'
                });
            }
            
            // 验证管理员密码
            const configAdminPassword = process.env.ADMIN_PASSWORD;
            if (!configAdminPassword) {
                return res.status(500).json({
                    success: false,
                    error: '系统未配置管理员密码'
                });
            }
            
            if (adminPassword !== configAdminPassword) {
                console.log(`❌ 删除服务者失败: 管理员密码错误 - 提供者ID: ${providerId}`);
                return res.status(403).json({
                    success: false,
                    error: '管理员密码错误'
                });
            }
            
            const db = getDatabase();
            
            // 获取服务者信息用于日志
            const provider = db.prepare(`
                SELECT name FROM providers WHERE id = ?
            `).get(providerId);
            
            if (!provider) {
                return res.status(404).json({
                    success: false,
                    error: '服务者不存在'
                });
            }
            
            // 开始事务删除相关数据
            const deleteTransaction = db.transaction(() => {
                // 1. 删除时间消息记录
                db.prepare(`DELETE FROM time_messages WHERE provider_id = ?`).run(providerId);
                
                // 2. 删除排班数据
                db.prepare(`DELETE FROM schedule_data WHERE provider_id = ?`).run(providerId);
                
                // 3. 删除时间段
                db.prepare(`DELETE FROM time_slots WHERE provider_id = ?`).run(providerId);
                
                // 4. 删除预约记录
                db.prepare(`DELETE FROM bookings WHERE provider_id = ?`).run(providerId);
                
                // 5. 删除频道帖子记录
                db.prepare(`DELETE FROM channel_posts WHERE provider_id = ?`).run(providerId);
                
                // 6. 最后删除服务者
                db.prepare(`DELETE FROM providers WHERE id = ?`).run(providerId);
            });
            
            deleteTransaction();
            
            console.log(`✅ 删除服务者成功: ${provider.name} (ID: ${providerId}) - 管理员操作`);
            
            res.json({
                success: true,
                message: `服务者 "${provider.name}" 及相关数据已删除`,
                deletedProvider: {
                    id: providerId,
                    name: provider.name
                }
            });
            
        } catch (error) {
            console.error('❌ 删除服务者失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
};

// 生成时间信息内容
function generateTimeMessage(providerName, scheduleData) {
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    
    let timeMessage = `📅 <b>${providerName} - 近期排班安排</b>\n\n`;
    
    Object.keys(scheduleData).forEach(date => {
        const data = scheduleData[date];
        const dateObj = new Date(date);
        const month = dateObj.getMonth() + 1;
        const day = dateObj.getDate();
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const weekday = weekdays[dateObj.getDay()];
        
        const dateStr = `${month}.${day} (${weekday})`;
        
        if (data.status === 'full') {
            timeMessage += `${dateStr}: 满 (有鸽更新)\n`;
        } else if (data.status === 'rest') {
            timeMessage += `${dateStr}: 休息\n`;
        } else if (data.slots && data.slots.length > 0) {
            timeMessage += `${dateStr}: ${data.slots.join('/')}点\n`;
        } else {
            timeMessage += `${dateStr}: 暂无安排\n`;
        }
    });
    
    timeMessage += `\n⏰ 更新时间: ${timeStr}`;
    
    return timeMessage;
}

module.exports = { setupAdminAPI }; 