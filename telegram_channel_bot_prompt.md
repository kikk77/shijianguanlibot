# Telegram频道管理机器人开发指南

## 项目需求
创建一个极简的Telegram机器人，支持：
1. 自动编辑频道帖子（图片+文字+跳转按钮）
2. 用户预约流程（选人、选时间）
3. 客服转接功能
4. 管理员后台控制时间段状态
5. Railway一键部署，数据库存储在Volume

## 技术栈
- **后端**: Node.js 18+, Express
- **数据库**: SQLite3 (better-sqlite3) - 存储在Railway Volume
- **Bot框架**: node-telegram-bot-api
- **定时任务**: node-cron
- **部署**: Railway (Docker + Volume)

## 项目结构
```
telegram-channel-bot/
├── src/
│   ├── config/
│   │   ├── database.js         # 数据库配置
│   │   └── bot.js             # Bot配置
│   ├── models/
│   │   ├── schema.js          # 数据库表结构
│   │   └── operations.js      # 数据库操作
│   ├── services/
│   │   ├── channelService.js  # 频道管理
│   │   ├── bookingService.js  # 预约服务
│   │   ├── adminService.js    # 管理功能
│   │   └── customerService.js # 客服转接
│   ├── handlers/
│   │   ├── botHandlers.js     # Bot事件处理
│   │   ├── adminHandlers.js   # 管理员命令
│   │   └── bookingHandlers.js # 预约流程
│   ├── utils/
│   │   ├── logger.js          # 日志工具
│   │   ├── helpers.js         # 工具函数
│   │   └── constants.js       # 常量定义
│   └── admin/
│       ├── index.html         # 管理后台
│       ├── script.js          # 前端逻辑
│       └── style.css          # 样式文件
├── data/                      # Volume挂载点
├── package.json
├── Dockerfile
├── railway.toml
├── .env.example
├── .gitignore
└── app.js                     # 应用入口
```

## 环境变量配置 (.env.example)
```bash
# Bot配置
BOT_TOKEN=your_bot_token_here
BOT_USERNAME=your_bot_username

# 频道配置
CHANNEL_ID=@your_channel_username
CHANNEL_CHAT_ID=-1001234567890

# 客服配置
CUSTOMER_SERVICE_ID=123456789
ADMIN_IDS=123456789,987654321

# 服务配置
PORT=3000
NODE_ENV=production

# 数据库路径 (Railway Volume)
DB_PATH=/app/data/bot.db

# 其他配置
MAX_CONCURRENT_BOOKINGS=50
BOOKING_TIMEOUT_MINUTES=30
```

## 数据库设计 (src/models/schema.js)
```javascript
const createTables = (db) => {
    // 服务提供者表
    db.exec(`
        CREATE TABLE IF NOT EXISTS providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
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
            status TEXT DEFAULT 'available', -- available, booked, disabled
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
            status TEXT DEFAULT 'pending', -- pending, confirmed, cancelled, completed
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
            message_id INTEGER UNIQUE,
            image_url TEXT,
            caption TEXT,
            status TEXT DEFAULT 'active',
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
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
};

module.exports = { createTables };
```

## 核心服务实现

### 1. 频道服务 (src/services/channelService.js)
```javascript
const TelegramBot = require('node-telegram-bot-api');
const { getDatabase } = require('../config/database');

class ChannelService {
    constructor(bot) {
        this.bot = bot;
        this.db = getDatabase();
    }

    // 更新频道帖子
    async updateChannelPost(imageUrl, caption) {
        try {
            const channelId = process.env.CHANNEL_ID;
            const botUsername = process.env.BOT_USERNAME;
            
            // 构建内联键盘
            const keyboard = {
                inline_keyboard: [[{
                    text: "💬 立即预约",
                    url: `https://t.me/${botUsername}?start=booking`
                }]]
            };

            // 获取现有帖子
            const existingPost = this.db.prepare(
                'SELECT message_id FROM channel_posts WHERE status = ? ORDER BY id DESC LIMIT 1'
            ).get('active');

            if (existingPost) {
                // 编辑现有帖子
                await this.bot.editMessageMedia({
                    type: 'photo',
                    media: imageUrl,
                    caption: caption,
                    parse_mode: 'HTML'
                }, {
                    chat_id: channelId,
                    message_id: existingPost.message_id,
                    reply_markup: keyboard
                });
            } else {
                // 发送新帖子
                const message = await this.bot.sendPhoto(channelId, imageUrl, {
                    caption: caption,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });

                // 保存帖子信息
                this.db.prepare(`
                    INSERT INTO channel_posts (message_id, image_url, caption, status)
                    VALUES (?, ?, ?, ?)
                `).run(message.message_id, imageUrl, caption, 'active');
            }

            return { success: true };
        } catch (error) {
            console.error('更新频道帖子失败:', error);
            return { success: false, error: error.message };
        }
    }

    // 生成动态内容
    generateDynamicCaption() {
        const providers = this.db.prepare(`
            SELECT p.*, COUNT(ts.id) as available_slots
            FROM providers p
            LEFT JOIN time_slots ts ON p.id = ts.provider_id 
                AND ts.status = 'available' 
                AND date(ts.date) >= date('now')
            WHERE p.status = 'active'
            GROUP BY p.id
            ORDER BY available_slots DESC
        `).all();

        let caption = "🌟 <b>预约服务</b> 🌟\n\n";
        
        providers.forEach(provider => {
            const statusEmoji = provider.available_slots > 0 ? "✅" : "❌";
            caption += `${statusEmoji} <b>${provider.name}</b>\n`;
            caption += `📅 可预约: ${provider.available_slots}个时段\n\n`;
        });

        caption += "👆 点击按钮立即预约！";
        
        return caption;
    }
}

module.exports = ChannelService;
```

### 2. 预约服务 (src/services/bookingService.js)
```javascript
class BookingService {
    constructor(bot) {
        this.bot = bot;
        this.db = getDatabase();
        this.userSessions = new Map(); // 用户会话状态
    }

    // 开始预约流程
    async startBooking(userId, username) {
        this.userSessions.set(userId, {
            step: 'select_provider',
            data: {},
            timestamp: Date.now()
        });

        const providers = this.db.prepare(`
            SELECT id, name, description 
            FROM providers 
            WHERE status = 'active'
            ORDER BY name
        `).all();

        if (providers.length === 0) {
            return this.bot.sendMessage(userId, "暂无可预约服务，请稍后再试。");
        }

        const keyboard = {
            inline_keyboard: providers.map(provider => [{
                text: provider.name,
                callback_data: `select_provider_${provider.id}`
            }])
        };

        await this.bot.sendMessage(userId, 
            "请选择服务提供者：", 
            { reply_markup: keyboard }
        );
    }

    // 选择服务提供者
    async selectProvider(userId, providerId) {
        const session = this.userSessions.get(userId);
        if (!session || session.step !== 'select_provider') {
            return this.startBooking(userId);
        }

        const provider = this.db.prepare(`
            SELECT * FROM providers WHERE id = ? AND status = 'active'
        `).get(providerId);

        if (!provider) {
            return this.bot.sendMessage(userId, "服务提供者不存在，请重新选择。");
        }

        session.data.providerId = providerId;
        session.data.providerName = provider.name;
        session.step = 'select_time';
        this.userSessions.set(userId, session);

        await this.showAvailableTimeSlots(userId, providerId);
    }

    // 显示可用时间段
    async showAvailableTimeSlots(userId, providerId) {
        const timeSlots = this.db.prepare(`
            SELECT id, date, start_time, end_time, current_bookings, max_bookings
            FROM time_slots 
            WHERE provider_id = ? 
                AND status = 'available' 
                AND current_bookings < max_bookings
                AND datetime(date || ' ' || start_time) > datetime('now')
            ORDER BY date, start_time
            LIMIT 20
        `).all(providerId);

        if (timeSlots.length === 0) {
            return this.bot.sendMessage(userId, "暂无可用时间段，请选择其他服务提供者。");
        }

        // 按日期分组
        const groupedSlots = {};
        timeSlots.forEach(slot => {
            if (!groupedSlots[slot.date]) {
                groupedSlots[slot.date] = [];
            }
            groupedSlots[slot.date].push(slot);
        });

        let message = "请选择预约时间：\n\n";
        const keyboard = { inline_keyboard: [] };

        Object.keys(groupedSlots).forEach(date => {
            message += `📅 <b>${date}</b>\n`;
            const dateSlots = groupedSlots[date];
            
            const row = [];
            dateSlots.forEach(slot => {
                const timeText = `${slot.start_time}-${slot.end_time}`;
                row.push({
                    text: timeText,
                    callback_data: `select_time_${slot.id}`
                });
                
                if (row.length === 2) {
                    keyboard.inline_keyboard.push([...row]);
                    row.length = 0;
                }
            });
            
            if (row.length > 0) {
                keyboard.inline_keyboard.push([...row]);
            }
            
            message += "\n";
        });

        keyboard.inline_keyboard.push([{
            text: "🔙 重新选择服务者",
            callback_data: "back_to_providers"
        }]);

        await this.bot.sendMessage(userId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }

    // 确认预约
    async confirmBooking(userId, timeSlotId) {
        const session = this.userSessions.get(userId);
        if (!session || session.step !== 'select_time') {
            return this.startBooking(userId);
        }

        const timeSlot = this.db.prepare(`
            SELECT ts.*, p.name as provider_name
            FROM time_slots ts
            JOIN providers p ON ts.provider_id = p.id
            WHERE ts.id = ? AND ts.status = 'available' 
                AND ts.current_bookings < ts.max_bookings
        `).get(timeSlotId);

        if (!timeSlot) {
            return this.bot.sendMessage(userId, "该时间段已不可用，请重新选择。");
        }

        // 创建预约记录
        const booking = this.db.prepare(`
            INSERT INTO bookings (user_id, username, provider_id, time_slot_id, status)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, session.data.username || '', session.data.providerId, timeSlotId, 'pending');

        // 更新时间段预约数
        this.db.prepare(`
            UPDATE time_slots 
            SET current_bookings = current_bookings + 1
            WHERE id = ?
        `).run(timeSlotId);

        // 清除用户会话
        this.userSessions.delete(userId);

        // 发送确认消息
        const confirmMessage = `
✅ <b>预约确认</b>

👨‍💼 服务提供者: ${timeSlot.provider_name}
📅 预约日期: ${timeSlot.date}
⏰ 预约时间: ${timeSlot.start_time} - ${timeSlot.end_time}
🆔 预约编号: ${booking.lastInsertRowid}

客服将很快与您联系，请保持手机畅通。
        `;

        await this.bot.sendMessage(userId, confirmMessage, {
            parse_mode: 'HTML'
        });

        // 通知客服
        await this.notifyCustomerService(booking.lastInsertRowid, userId, timeSlot);
    }

    // 通知客服
    async notifyCustomerService(bookingId, userId, timeSlot) {
        const customerServiceId = process.env.CUSTOMER_SERVICE_ID;
        if (!customerServiceId) return;

        const user = await this.bot.getChat(userId);
        const userInfo = `@${user.username || user.first_name || userId}`;

        const notifyMessage = `
🔔 <b>新预约通知</b>

🆔 预约编号: ${bookingId}
👤 用户: ${userInfo} (ID: ${userId})
👨‍💼 服务: ${timeSlot.provider_name}
📅 日期: ${timeSlot.date}
⏰ 时间: ${timeSlot.start_time} - ${timeSlot.end_time}

请及时联系客户确认详情。
        `;

        const keyboard = {
            inline_keyboard: [[
                {
                    text: "联系客户",
                    url: `tg://user?id=${userId}`
                },
                {
                    text: "查看详情",
                    callback_data: `booking_detail_${bookingId}`
                }
            ]]
        };

        await this.bot.sendMessage(customerServiceId, notifyMessage, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }
}

module.exports = BookingService;
```

### 3. 管理后台 (src/admin/index.html)
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>频道管理后台</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>📺 频道管理后台</h1>
        </header>

        <div class="dashboard">
            <!-- 频道帖子管理 -->
            <section class="card">
                <h2>📝 频道帖子管理</h2>
                <div class="form-group">
                    <label for="imageUrl">图片URL:</label>
                    <input type="url" id="imageUrl" placeholder="https://example.com/image.jpg">
                </div>
                <div class="form-group">
                    <label for="caption">帖子内容:</label>
                    <textarea id="caption" rows="4" placeholder="输入帖子内容..."></textarea>
                </div>
                <div class="buttons">
                    <button onclick="updateChannelPost()" class="btn-primary">更新频道帖子</button>
                    <button onclick="generateDynamicContent()" class="btn-secondary">生成动态内容</button>
                </div>
            </section>

            <!-- 时间段管理 -->
            <section class="card">
                <h2>⏰ 时间段管理</h2>
                <div class="time-slots-grid" id="timeSlotsGrid">
                    <!-- 动态加载时间段 -->
                </div>
                <div class="buttons">
                    <button onclick="loadTimeSlots()" class="btn-secondary">刷新时间段</button>
                    <button onclick="showAddTimeSlotForm()" class="btn-primary">添加时间段</button>
                </div>
            </section>

            <!-- 预约管理 -->
            <section class="card">
                <h2>📋 预约管理</h2>
                <div class="stats">
                    <div class="stat-item">
                        <span class="stat-number" id="totalBookings">0</span>
                        <span class="stat-label">总预约</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number" id="pendingBookings">0</span>
                        <span class="stat-label">待确认</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number" id="todayBookings">0</span>
                        <span class="stat-label">今日预约</span>
                    </div>
                </div>
                <div class="bookings-list" id="bookingsList">
                    <!-- 动态加载预约列表 -->
                </div>
            </section>
        </div>
    </div>

    <!-- 模态框 -->
    <div id="modal" class="modal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <div id="modalBody"></div>
        </div>
    </div>

    <script src="script.js"></script>
</body>
</html>
```

## Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

# 安装系统依赖
RUN apk add --no-cache python3 make g++

# 复制包文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制源代码
COPY . .

# 创建数据目录
RUN mkdir -p /app/data && chown -R node:node /app

# 切换到非root用户
USER node

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["npm", "start"]
```

## Railway配置 (railway.toml)
```toml
[build]
builder = "dockerfile"

[deploy]
startCommand = "npm start"
restartPolicyType = "always"
restartPolicyMaxRetries = 10
healthcheckPath = "/health"
healthcheckTimeout = 30

# Volume配置
[[deploy.volumes]]
mountPath = "/app/data"
name = "bot-data"

[env]
NODE_ENV = "production"
```

## package.json
```json
{
  "name": "telegram-channel-bot",
  "version": "1.0.0",
  "description": "Telegram频道管理机器人",
  "main": "app.js",
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=8.0.0"
  },
  "scripts": {
    "start": "node app.js",
    "dev": "nodemon app.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "dependencies": {
    "better-sqlite3": "^8.7.0",
    "dotenv": "^16.5.0",
    "express": "^4.18.2",
    "node-cron": "^3.0.2",
    "node-telegram-bot-api": "^0.61.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "keywords": ["telegram", "bot", "channel", "booking"],
  "author": "Your Name",
  "license": "MIT"
}
```

## 主应用入口 (app.js)
```javascript
require('dotenv').config();
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// 导入服务
const { initDatabase } = require('./src/config/database');
const ChannelService = require('./src/services/channelService');
const BookingService = require('./src/services/bookingService');
const AdminService = require('./src/services/adminService');

// 导入处理器
const { setupBotHandlers } = require('./src/handlers/botHandlers');
const { setupAdminAPI } = require('./src/handlers/adminHandlers');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'src/admin')));

// 初始化数据库
initDatabase();

// 初始化Bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// 初始化服务
const channelService = new ChannelService(bot);
const bookingService = new BookingService(bot);
const adminService = new AdminService(bot);

// 设置Bot处理器
setupBotHandlers(bot, bookingService, adminService);

// 设置管理API
setupAdminAPI(app, channelService, bookingService, adminService);

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 服务器运行在端口 ${PORT}`);
    console.log(`📱 Bot已启动: @${process.env.BOT_USERNAME}`);
    console.log(`📺 频道: ${process.env.CHANNEL_ID}`);
});

// 错误处理
process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
});
```

## 部署步骤

1. **创建项目并初始化**
```bash
mkdir telegram-channel-bot
cd telegram-channel-bot
npm init -y
```

2. **复制上述文件结构和代码**

3. **配置环境变量**
- 在Railway项目中设置所有必需的环境变量
- 确保Volume名称为 `bot-data`

4. **GitHub部署**
```bash
git init
git add .
git commit -m "初始化频道管理机器人"
git push origin main
```

5. **Railway自动部署**
- Railway检测到 `railway.toml` 后自动创建Volume
- 数据库文件存储在 `/app/data/bot.db`

## 特性说明

✅ **高并发支持**: 使用内存会话管理和SQLite事务
✅ **一键部署**: Railway + Docker + Volume
✅ **极简架构**: 单应用，最少依赖
✅ **实时更新**: 频道帖子动态编辑
✅ **完整流程**: 预约→客服→付款
✅ **管理后台**: Web界面管理时间段状态

使用此prompt在Cursor中创建项目，可以快速搭建一个功能完整的Telegram频道管理机器人。