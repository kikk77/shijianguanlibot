FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 安装系统依赖 (better-sqlite3需要)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite

# 复制package文件
COPY package*.json ./

# 安装npm依赖
RUN npm install --production && npm cache clean --force

# 复制应用代码
COPY . .

# 创建数据目录并设置权限
RUN mkdir -p /app/data && \
    chown -R node:node /app

# 切换到非root用户
USER node

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"] 