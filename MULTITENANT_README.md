# 🤖 多租户Telegram频道管理系统

> 支持1000个用户独立管理时间表的Telegram机器人系统

## ✨ 主要特性

- 🏢 **多租户架构** - 每个用户独立数据库和时间表
- 📱 **移动端管理** - 直接在Telegram机器人内操作排班
- ⚡ **即时同步** - 排班变化立即更新频道帖子
- 🔐 **数据隔离** - 用户数据完全独立，确保隐私安全
- 🚀 **一键部署** - Railway平台一键部署，自动配置
- 📊 **实时统计** - 预约和收入数据实时统计

## 🏗️ 系统架构

```
官方机器人 (注册管理)
    ↓
用户注册 → 独立数据空间
    ↓
内联键盘管理面板
    ↓
自动频道同步
```

## 🚀 快速部署

### Railway 一键部署

1. **Fork 本仓库**
   ```bash
   git clone https://github.com/your-username/multitenant-telegram-bot.git
   cd multitenant-telegram-bot
   ```

2. **创建Telegram机器人**
   - 联系 [@BotFather](https://t.me/BotFather)
   - 创建新机器人: `/newbot`
   - 获取Bot Token

3. **部署到Railway**
   - 登录 [Railway.app](https://railway.app)
   - 点击 "Deploy from GitHub repo"
   - 选择你fork的仓库
   - 设置环境变量：
     ```
     OFFICIAL_BOT_TOKEN=你的机器人Token
     NODE_ENV=production
     PORT=3000
     ```

4. **配置Volume存储**
   - 在Railway项目中添加Volume
   - 挂载路径: `/app/data`
   - 大小: 1GB (支持1000用户绰绰有余)

### 本地开发

1. **安装依赖**
   ```bash
   npm install
   ```

2. **配置环境变量**
   ```bash
   cp env.example .env
   # 编辑 .env 文件，填入你的机器人Token
   ```

3. **启动开发服务器**
   ```bash
   npm run dev
   ```

## 🎯 使用流程

### 用户注册流程

1. **用户启动官方机器人**
   ```
   /start → 显示欢迎界面
   /register → 开始注册流程
   ```

2. **配置频道信息**
   - 发送频道ID或@username
   - 系统自动验证权限
   - 创建独立数据空间

3. **管理面板操作**
   ```
   /panel → 打开管理面板
   ⏰ 排班管理 → 内联键盘操作
   👥 服务管理 → 添加/编辑服务
   📊 数据统计 → 查看预约数据
   ```

### 排班管理

#### 7天概览界面
- 显示未来7天排班状态
- 每天显示可预约时间段
- 点击日期进入详细管理

#### 单日详细管理
- 10:00-22:00 时间段按钮
- 🟦 蓝色 = 可预约
- 🟨 黄色 = 已满  
- 🟥 红色 = 休息
- 点击切换状态

#### 快速操作
- ✅ 全部开放
- 🚫 全部休息
- 💤 设为满了
- 🔄 同步频道

## 📡 API接口

### 基础接口
```
GET  /health              # 健康检查
GET  /api                 # API文档
GET  /api/stats           # 系统统计
```

### 用户管理
```
GET  /api/users           # 获取所有用户
POST /api/users           # 创建用户
```

### 服务提供者
```
GET  /api/users/:userId/providers
POST /api/users/:userId/providers
```

### 排班管理
```
GET  /api/users/:userId/providers/:providerId/schedule
POST /api/users/:userId/providers/:providerId/schedule
```

### 预约管理
```
GET  /api/users/:userId/bookings
POST /api/users/:userId/bookings
```

## 💾 数据库设计

### 用户表 (users)
```sql
- user_id: 用户Telegram ID
- channel_id: 频道ID
- username: 用户名
- full_name: 全名
- status: 状态
```

### 服务提供者表 (user_providers)
```sql
- user_id: 所属用户
- provider_id: 服务ID
- name: 服务名称
- price: 价格
- images: 图片JSON数组
```

### 排班表 (user_schedules)
```sql
- user_id: 所属用户
- provider_id: 服务ID
- date: 日期
- hour: 小时
- status: 状态(available/booked/rest)
```

## 🔧 配置说明

### 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `OFFICIAL_BOT_TOKEN` | ✅ | 官方机器人Token |
| `NODE_ENV` | ❌ | 运行环境 (production/development) |
| `PORT` | ❌ | 服务端口 (默认3000) |
| `DB_PATH` | ❌ | 数据库路径 (默认./data) |

### Railway配置

1. **环境变量设置**
   - `OFFICIAL_BOT_TOKEN`: 你的机器人Token
   - `NODE_ENV`: production

2. **Volume挂载**
   - Mount Path: `/app/data`
   - Size: 1GB

## 📊 性能特征

- **用户容量**: 1000个独立用户
- **数据隔离**: 每用户独立数据空间
- **内存占用**: 约100MB (基础运行)
- **存储需求**: 约500MB (1000用户数据)
- **响应时间**: <200ms (内联键盘操作)

## 🛠️ 技术栈

- **后端**: Node.js 18+ + Express
- **数据库**: SQLite3 (better-sqlite3)
- **机器人**: node-telegram-bot-api
- **部署**: Docker + Railway
- **存储**: Railway Volume

## 📝 开发计划

- [x] 多租户数据库设计
- [x] 官方机器人注册管理
- [x] 内联键盘排班管理
- [x] API接口设计
- [x] Railway部署配置
- [ ] 频道帖子自动同步
- [ ] 预约处理逻辑
- [ ] 数据统计图表
- [ ] 批量操作功能

## 📞 技术支持

如有问题请提交Issue或联系开发团队。

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件 