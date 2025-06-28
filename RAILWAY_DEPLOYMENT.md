# Railway 部署配置指南

## 环境变量设置

在Railway项目中，需要设置以下环境变量：

### 必需环境变量

```
OFFICIAL_BOT_TOKEN=你的Telegram机器人Token
NODE_ENV=production
PORT=3000
```

### 可选环境变量

```
OFFICIAL_BOT_USERNAME=你的机器人用户名
DB_PATH=/var/lib/containers/railwayapp/bind-mounts/volume/data
LOG_LEVEL=info
MAX_USERS=1000
MAX_PROVIDERS_PER_USER=10
```

## 获取Telegram机器人Token

1. 找到 @BotFather 在Telegram中
2. 发送 `/newbot` 命令
3. 按照指引创建机器人
4. 获取机器人Token（格式：`123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ`）
5. 将Token设置为 `OFFICIAL_BOT_TOKEN` 环境变量

## Railway Volume 配置

1. 在Railway项目中创建Volume
2. 挂载点设置为：`/var/lib/containers/railwayapp/bind-mounts/volume`
3. 数据库文件将存储在：`/var/lib/containers/railwayapp/bind-mounts/volume/data/multitenant_bot.db`

## 部署流程

1. 推送代码到GitHub仓库
2. 在Railway中连接GitHub仓库
3. 设置环境变量
4. 配置Volume
5. 部署服务

## 故障排除

### 机器人Token未设置
如果看到错误：`Cannot set properties of null (setting 'showProvidersPanel')`
- 检查 `OFFICIAL_BOT_TOKEN` 环境变量是否设置
- 确认Token格式正确
- 重新部署服务

### 数据库问题
如果数据库无法创建：
- 检查Volume是否正确挂载
- 确认挂载路径权限
- 查看容器日志

## 健康检查

部署成功后，访问：
- `https://your-app.railway.app/` - 主页面
- `https://your-app.railway.app/api/health` - 健康检查接口

## 联系支持

如果遇到部署问题，请检查：
1. Railway项目日志
2. 环境变量设置
3. Volume配置
4. 机器人Token有效性 