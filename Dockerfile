FROM node:22-slim

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json* ./
RUN npm ci

# 复制源码
COPY . .

# 清理可能残留的 Cloudflare 配置文件
RUN rm -f open-next.config.ts open-next.config.js wrangler.jsonc wrangler.toml

# 创建运行时需要的本地目录
RUN mkdir -p outputs assets logs backups exports xiaohongshu-downloads

# 构建参数（NEXT_PUBLIC_* 需要构建时传入）
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_EN_NAME
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
ENV NODE_OPTIONS=--max-old-space-size=4096

# 构建 Next.js
RUN npm run build

# 运行环境
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
