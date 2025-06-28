# ⏰ 时间管理机器人 (Telegram Time Management Bot)

一个专业的Telegram频道时间表管理工具，帮助管理员快速更新排班信息并自动发送到频道。

## 🎯 主要功能

### 📅 时间表管理
- **连续7天排班显示**：清晰展示未来7天的时间安排
- **简洁时间格式**：使用 14/17/18/19点 的简洁数字格式
- **快速状态切换**：一键设置满/休息/正常排班
- **实时预览更新**：修改后立即更新时间预览

### 📤 自动频道发送
- **专用时间信息发送**：点击按钮发送纯时间表到频道
- **自动清理机制**：发送新时间信息时自动删除旧消息
- **保持频道整洁**：避免重复的时间信息堆积

### 👥 服务管理
- **多服务提供者支持**：管理多个服务人员的排班
- **动态数据加载**：实时从数据库获取最新信息
- **统计数据展示**：显示预约总数、待确认数等关键指标

## 🏗️ 技术架构

- **后端**: Node.js + Express
- **数据库**: SQLite3 (better-sqlite3)
- **Bot框架**: node-telegram-bot-api
- **部署**: Railway + Docker + Volume
- **存储**: Railway Volume 持久化数据

## 🚀 快速部署

### 1. 环境要求
- Node.js 18+
- Telegram Bot Token
- Telegram频道管理员权限

### 2. 环境变量配置
```bash
# Bot配置
BOT_TOKEN=your_bot_token
BOT_USERNAME=your_bot_username

# 频道配置
CHANNEL_ID=your_channel_id

# 应用配置
PORT=3000
NODE_ENV=production
DB_PATH=/app/data/bot.db
```

### 3. Railway一键部署

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template-id)

**手动部署步骤：**

1. Fork 本仓库
2. 在Railway创建新项目
3. 连接GitHub仓库
4. 设置环境变量
5. 创建Volume：
   - 名称：`bot-data`
   - 挂载路径：`/app/data`
6. 部署完成

### 4. 本地开发

```bash
# 克隆仓库
git clone https://github.com/your-username/shijianguanlibot.git
cd shijianguanlibot

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件

# 启动开发服务器
npm run dev
```

## 📋 使用说明

### 管理员操作流程

1. **访问管理后台**：`https://your-app.railway.app`
2. **选择服务提供者**：从下拉菜单选择要管理的人员
3. **设置时间表**：
   - 点击数字按钮切换时间段开关（蓝色=开放，灰色=关闭）
   - 使用"设为满/休息/正常排班"快速设置整天状态
4. **发送到频道**：点击"发送时间信息到频道"按钮
5. **实时更新**：系统自动删除旧消息，发送新时间表

### 客人体验流程

1. **查看频道**：打开Telegram频道
2. **看到时间信息**：第一眼看到清晰的排班安排
3. **选择时间**：根据显示的可用时间段选择
4. **联系预约**：通过其他方式联系服务提供者

## 🎨 界面预览

- **📱 管理后台**：现代化的Web界面，响应式设计
- **📊 数据统计**：实时显示预约数量和可用时段
- **⏰ 时间管理**：直观的7天排班表管理
- **📤 一键发送**：简单点击即可更新频道信息

## 🔧 配置说明

### Bot权限要求
确保你的Telegram Bot在频道中具有以下权限：
- ✅ 发送消息
- ✅ 删除消息
- ✅ 编辑消息（可选）

### 数据库结构
- `providers`: 服务提供者信息
- `schedule_data`: 排班数据
- `time_messages`: 时间消息记录
- `bookings`: 预约记录
- `system_config`: 系统配置

## 📂 项目结构

```
shijianguanlibot/
├── src/
│   ├── api/
│   │   └── adminHandlers.js      # API路由处理
│   ├── config/
│   │   └── database.js           # 数据库配置
├── admin_prototype.html          # 管理后台页面
├── app.js                       # 应用入口
├── package.json                 # 依赖配置
├── Dockerfile                   # Docker配置
└── README.md                    # 项目说明
```

## 🚀 核心特性

- **⚡ 极简操作**：几秒钟即可更新时间状态
- **🔄 自动清理**：避免频道消息重复
- **📱 移动友好**：支持手机端管理
- **💾 数据持久化**：Railway Volume安全存储
- **🔒 权限控制**：管理员专用后台

## 🔍 故障排除

### 常见问题
1. **Bot无法发送消息**：检查Bot是否为频道管理员
2. **数据库连接失败**：确认Volume配置正确
3. **环境变量错误**：检查Railway环境变量设置

### 日志查看
```bash
# Railway日志
railway logs

# 本地开发日志
npm run dev
```

## 📈 版本历史

- **v1.0.0**: 初始版本，基础时间表管理功能
- **v1.1.0**: 添加自动清理和实时预览
- **v1.2.0**: 优化UI界面和用户体验

## 🤝 贡献指南

欢迎提交Issue和Pull Request来改进项目！

## 📄 许可证

MIT License

## 🆘 技术支持

如有问题请提交Issue或联系维护者。

---

⭐ 如果这个项目对你有帮助，请给个Star支持！ 