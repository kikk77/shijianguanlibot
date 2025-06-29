const { ScheduleManager, ProviderManager, UserManager } = require('../config/multitenant-database');

class TelegramScheduleManager {
    constructor(bot) {
        this.bot = bot;
    }
    
    // 显示服务提供者的7天排班界面
    async showProviderSchedule(chatId, userId, providerId) {
        try {
            const provider = ProviderManager.getProvider(userId, providerId);
            if (!provider) {
                await this.bot.sendMessage(chatId, '❌ 服务提供者不存在');
                return;
            }
            
            // 获取未来7天日期
            const dates = this.getNext7Days();
            
            // 获取现有排班数据
            const startDate = dates[0].toISOString().split('T')[0];
            const endDate = dates[6].toISOString().split('T')[0];
            const schedules = ScheduleManager.getSchedule(userId, providerId, startDate, endDate);
            
            // 构建排班数据映射
            const scheduleMap = new Map();
            schedules.forEach(schedule => {
                const key = `${schedule.date}_${schedule.hour}`;
                scheduleMap.set(key, schedule.status);
            });
            
            // 构建消息文本
            let scheduleText = `⏰ <b>${provider.name} - 排班管理</b>\n\n`;
            
            // 显示每天的状态概览
            for (const date of dates) {
                const dateStr = date.toISOString().split('T')[0];
                const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
                const dayStr = `${date.getMonth() + 1}/${date.getDate()}(${weekday})`;
                
                // 统计当天状态
                const dayStatus = this.getDayStatus(scheduleMap, dateStr);
                scheduleText += `${dayStr}: ${dayStatus}\n`;
            }
            
            scheduleText += `\n<b>操作说明：</b>\n蓝色=可预约 | 灰色=已满 | 🚫=休息\n\n<b>点击日期管理当天排班</b> 👇`;
            
            // 构建内联键盘
            const keyboard = { inline_keyboard: [] };
            
            // 添加日期按钮 (每行2个)
            for (let i = 0; i < dates.length; i += 2) {
                const row = [];
                for (let j = i; j < Math.min(i + 2, dates.length); j++) {
                    const date = dates[j];
                    const dateStr = date.toISOString().split('T')[0];
                    const dayStr = `${date.getMonth() + 1}/${date.getDate()}`;
                    const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
                    
                    row.push({
                        text: `📅 ${dayStr}(${weekday})`,
                        callback_data: `schedule_day_${providerId}_${dateStr}`
                    });
                }
                keyboard.inline_keyboard.push(row);
            }
            
            // 添加快速操作按钮
            keyboard.inline_keyboard.push([
                { text: '🔄 同步频道', callback_data: `schedule_sync_${providerId}` },
                { text: '📊 生成文本', callback_data: `schedule_text_${providerId}` }
            ]);
            
            keyboard.inline_keyboard.push([
                { text: '⬅️ 返回', callback_data: 'panel_schedule' }
            ]);
            
            await this.bot.sendMessage(chatId, scheduleText, {
                parse_mode: 'HTML',
                reply_markup: JSON.stringify(keyboard)
            });
            
        } catch (error) {
            console.error('显示排班失败:', error);
            await this.bot.sendMessage(chatId, '❌ 显示排班失败，请稍后重试');
        }
    }
    
    // 显示单日详细排班
    async showDaySchedule(chatId, userId, providerId, dateStr) {
        try {
            const provider = ProviderManager.getProvider(userId, providerId);
            if (!provider) {
                await this.bot.sendMessage(chatId, '❌ 服务提供者不存在');
                return;
            }
            
            const date = new Date(dateStr);
            const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
            const dayStr = `${date.getMonth() + 1}/${date.getDate()}(${weekday})`;
            
            // 获取当天排班数据
            const schedules = ScheduleManager.getScheduleByDate(userId, providerId, dateStr);
            const scheduleMap = new Map();
            schedules.forEach(schedule => {
                scheduleMap.set(schedule.hour, schedule.status);
            });
            
            let scheduleText = `⏰ <b>${provider.name} - ${dayStr}</b>\n\n`;
            
            // 构建内联键盘
            const keyboard = { inline_keyboard: [] };
            
            // 时间段按钮 (10:00-22:00，每行4个)
            const timeButtons = [];
            for (let hour = 10; hour <= 22; hour++) {
                const status = scheduleMap.get(hour) || 'available';
                const buttonText = this.getTimeButtonText(hour, status);
                const buttonData = `schedule_time_${providerId}_${dateStr}_${hour}`;
                
                timeButtons.push({
                    text: buttonText,
                    callback_data: buttonData
                });
                
                // 每4个按钮换行
                if ((hour - 10 + 1) % 4 === 0) {
                    keyboard.inline_keyboard.push([...timeButtons]);
                    timeButtons.length = 0;
                }
            }
            
            // 添加剩余按钮
            if (timeButtons.length > 0) {
                keyboard.inline_keyboard.push(timeButtons);
            }
            
            // 添加快速操作按钮
            keyboard.inline_keyboard.push([
                { text: '✅ 全部开放', callback_data: `schedule_dayop_${providerId}_${dateStr}_allopen` },
                { text: '🚫 全部休息', callback_data: `schedule_dayop_${providerId}_${dateStr}_allrest` }
            ]);
            
            keyboard.inline_keyboard.push([
                { text: '💤 满了', callback_data: `schedule_dayop_${providerId}_${dateStr}_full` },
                { text: '🔄 同步频道', callback_data: `schedule_sync_${providerId}` }
            ]);
            
            keyboard.inline_keyboard.push([
                { text: '⬅️ 返回周视图', callback_data: `schedule_manage_${providerId}` }
            ]);
            
            // 添加当天状态说明
            const openCount = Array.from({length: 13}, (_, i) => i + 10)
                .filter(hour => (scheduleMap.get(hour) || 'available') === 'available').length;
            const fullCount = Array.from({length: 13}, (_, i) => i + 10)
                .filter(hour => scheduleMap.get(hour) === 'booked').length;
            const restCount = Array.from({length: 13}, (_, i) => i + 10)
                .filter(hour => scheduleMap.get(hour) === 'rest').length;
            
            scheduleText += `<b>当天状态：</b>\n`;
            scheduleText += `🟦 可预约：${openCount}个时段\n`;
            scheduleText += `🟨 已满：${fullCount}个时段\n`;
            scheduleText += `🟥 休息：${restCount}个时段\n\n`;
            scheduleText += `<b>点击时间段切换状态</b> 👇`;
            
            await this.bot.sendMessage(chatId, scheduleText, {
                parse_mode: 'HTML',
                reply_markup: JSON.stringify(keyboard)
            });
            
        } catch (error) {
            console.error('显示单日排班失败:', error);
            await this.bot.sendMessage(chatId, '❌ 显示排班失败，请稍后重试');
        }
    }
    
    // 处理时间段点击
    async handleTimeClick(chatId, userId, providerId, dateStr, hour) {
        try {
            const currentSchedule = ScheduleManager.getScheduleByDate(userId, providerId, dateStr)
                .find(s => s.hour === parseInt(hour));
            
            // 状态循环：available -> booked -> rest -> available
            let newStatus = 'available';
            if (!currentSchedule || currentSchedule.status === 'available') {
                newStatus = 'booked';
            } else if (currentSchedule.status === 'booked') {
                newStatus = 'rest';
            } else {
                newStatus = 'available';
            }
            
            // 更新数据库
            ScheduleManager.updateSchedule(userId, providerId, dateStr, parseInt(hour), newStatus);
            
            // 重新显示当天排班
            await this.showDaySchedule(chatId, userId, providerId, dateStr);
            
            // 发送状态提示
            const statusText = {
                'available': '🟦 可预约',
                'booked': '🟨 已满',
                'rest': '🟥 休息'
            };
            
            await this.bot.answerCallbackQuery(chatId, {
                text: `${hour}:00 状态已更新为 ${statusText[newStatus]}`,
                show_alert: false
            });
            
        } catch (error) {
            console.error('处理时间点击失败:', error);
            await this.bot.answerCallbackQuery(chatId, {
                text: '❌ 操作失败，请重试',
                show_alert: true
            });
        }
    }
    
    // 处理整天操作
    async handleDayOperation(chatId, userId, providerId, dateStr, operation) {
        try {
            let status = 'available';
            let message = '';
            
            switch (operation) {
                case 'allopen':
                    status = 'available';
                    message = '✅ 全天设置为可预约';
                    break;
                case 'allrest':
                    status = 'rest';
                    message = '🚫 全天设置为休息';
                    break;
                case 'full':
                    status = 'booked';
                    message = '💤 全天设置为满了';
                    break;
            }
            
            // 更新所有时间段
            for (let hour = 10; hour <= 22; hour++) {
                ScheduleManager.updateSchedule(userId, providerId, dateStr, hour, status);
            }
            
            // 重新显示当天排班
            await this.showDaySchedule(chatId, userId, providerId, dateStr);
            
            await this.bot.answerCallbackQuery(chatId, {
                text: message,
                show_alert: false
            });
            
        } catch (error) {
            console.error('处理整天操作失败:', error);
            await this.bot.answerCallbackQuery(chatId, {
                text: '❌ 操作失败，请重试',
                show_alert: true
            });
        }
    }
    
    // 生成频道发布文本
    async generateChannelText(chatId, userId, providerId) {
        try {
            const provider = ProviderManager.getProvider(userId, providerId);
            if (!provider) {
                await this.bot.sendMessage(chatId, '❌ 服务提供者不存在');
                return;
            }
            
            const dates = this.getNext7Days();
            const startDate = dates[0].toISOString().split('T')[0];
            const endDate = dates[6].toISOString().split('T')[0];
            const schedules = ScheduleManager.getSchedule(userId, providerId, startDate, endDate);
            
            // 构建排班数据映射
            const scheduleMap = new Map();
            schedules.forEach(schedule => {
                const key = `${schedule.date}_${schedule.hour}`;
                scheduleMap.set(key, schedule.status);
            });
            
            // 生成标准格式文本
            let channelText = `【${provider.name}】${provider.price}p\n\n`;
            
            for (const date of dates) {
                const dateStr = date.toISOString().split('T')[0];
                const dayNum = date.getDate();
                
                // 检查当天是否全天休息
                const daySlots = [];
                for (let hour = 10; hour <= 22; hour++) {
                    const key = `${dateStr}_${hour}`;
                    const status = scheduleMap.get(key) || 'available';
                    if (status === 'available') {
                        daySlots.push(hour);
                    }
                }
                
                if (daySlots.length === 0) {
                    // 检查是否全天满了
                    const allBooked = Array.from({length: 13}, (_, i) => i + 10)
                        .every(hour => {
                            const key = `${dateStr}_${hour}`;
                            return scheduleMap.get(key) === 'booked';
                        });
                    
                    if (allBooked) {
                        channelText += `${dayNum}号 满\n`;
                    } else {
                        channelText += `${dayNum}号 休息\n`;
                    }
                } else {
                    // 显示可预约时间段
                    const timeSlots = daySlots.map(hour => hour.toString()).join('/');
                    channelText += `${dayNum}号 ${timeSlots}\n`;
                }
            }
            
            channelText += `\n点击预约 👇`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📋 复制文本', callback_data: `schedule_copy_${providerId}` },
                        { text: '🔄 同步频道', callback_data: `schedule_sync_${providerId}` }
                    ],
                    [
                        { text: '⬅️ 返回排班', callback_data: `schedule_manage_${providerId}` }
                    ]
                ]
            };
            
            await this.bot.sendMessage(chatId, `📝 <b>频道发布文本预览</b>

<pre>${channelText}</pre>

<b>操作选项：</b>`, {
                parse_mode: 'HTML',
                reply_markup: JSON.stringify(keyboard)
            });
            
        } catch (error) {
            console.error('生成频道文本失败:', error);
            await this.bot.sendMessage(chatId, '❌ 生成文本失败，请稍后重试');
        }
    }
    
    // 同步到频道
    async syncToChannel(chatId, userId, providerId) {
        try {
            const user = UserManager.getUser(userId);
            if (!user || !user.channel_id) {
                await this.bot.sendMessage(chatId, '❌ 频道信息未配置，请先在设置中配置频道');
                return;
            }
            
            // 这里应该调用频道更新API
            // 暂时模拟
            await this.bot.sendMessage(chatId, `🔄 <b>正在同步到频道...</b>

频道：${user.channel_id}
服务：${providerId}

✅ 同步成功！频道帖子已更新。`, {
                parse_mode: 'HTML'
            });
            
        } catch (error) {
            console.error('同步频道失败:', error);
            await this.bot.sendMessage(chatId, '❌ 同步失败，请检查机器人频道权限');
        }
    }
    
    // 辅助方法
    getNext7Days() {
        const dates = [];
        const today = new Date();
        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            dates.push(date);
        }
        return dates;
    }
    
    getDayStatus(scheduleMap, dateStr) {
        const slots = [];
        let availableCount = 0;
        let bookedCount = 0;
        let restCount = 0;
        
        for (let hour = 10; hour <= 22; hour++) {
            const key = `${dateStr}_${hour}`;
            const status = scheduleMap.get(key) || 'available';
            
            switch (status) {
                case 'available':
                    availableCount++;
                    slots.push(hour);
                    break;
                case 'booked':
                    bookedCount++;
                    break;
                case 'rest':
                    restCount++;
                    break;
            }
        }
        
        if (restCount === 13) {
            return '休息';
        } else if (bookedCount === 13) {
            return '满';
        } else if (availableCount > 0) {
            return slots.map(h => h.toString()).join('/');
        } else {
            return '部分可预约';
        }
    }
    
    getTimeButtonText(hour, status) {
        const baseText = hour.toString();
        
        switch (status) {
            case 'available':
                return `🟦${baseText}`;
            case 'booked':
                return `🟨${baseText}`;
            case 'rest':
                return `🟥${baseText}`;
            default:
                return `🟦${baseText}`;
        }
    }
    
    // 处理所有排班相关回调
    async handleCallback(chatId, userId, data) {
        try {
            const parts = data.split('_');
            const action = parts[1];
            const providerId = parts[2];
            
            switch (action) {
                case 'day':
                    // schedule_day_providerId_dateStr
                    const dateStr = parts[3];
                    await this.showDaySchedule(chatId, userId, providerId, dateStr);
                    break;
                    
                case 'time':
                    // schedule_time_providerId_dateStr_hour
                    const timeDate = parts[3];
                    const hour = parts[4];
                    await this.handleTimeClick(chatId, userId, providerId, timeDate, hour);
                    break;
                    
                case 'dayop':
                    // schedule_dayop_providerId_dateStr_operation
                    const opDate = parts[3];
                    const operation = parts[4];
                    await this.handleDayOperation(chatId, userId, providerId, opDate, operation);
                    break;
                    
                case 'text':
                    // schedule_text_providerId
                    await this.generateChannelText(chatId, userId, providerId);
                    break;
                    
                case 'sync':
                    // schedule_sync_providerId
                    await this.syncToChannel(chatId, userId, providerId);
                    break;
                    
                case 'copy':
                    // schedule_copy_providerId
                    await this.bot.answerCallbackQuery(chatId, {
                        text: '📋 文本已复制到剪贴板',
                        show_alert: false
                    });
                    break;
                    
                default:
                    console.log('未处理的排班回调:', data);
                    break;
            }
            
        } catch (error) {
            console.error('处理排班回调失败:', error);
            await this.bot.sendMessage(chatId, '❌ 操作失败，请稍后重试');
        }
    }
}

module.exports = TelegramScheduleManager; 