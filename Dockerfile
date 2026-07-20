FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN rm -f open-next.config.ts open-next.config.js wrangler.jsonc wrangler.toml
RUN mkdir -p outputs assets logs backups exports xiaohongshu-downloads

ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_EN_NAME
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
ENV NODE_OPTIONS=--max-old-space-size=4096

RUN npm run build

# 调试用：检查生成的 CSS 文件
RUN echo "=== CSS files ===" && ls -la .next/static/css/ 2>/dev/null || echo "no css dir" && \
    echo "=== First CSS file head ===" && \
    for f in .next/static/css/*.css; do echo "--- $f ---"; head -c 500 "$f" 2>/dev/null || echo "empty"; break; done

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
