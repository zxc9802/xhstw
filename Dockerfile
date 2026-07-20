FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
ENV NODE_OPTIONS=--max-old-space-size=4096

# 先单独测试 Tailwind 是否能处理 globals.css
RUN npx tailwindcss -i ./app/globals.css -o /tmp/tailwind-test.css 2>&1 || (echo "=== TAILWIND TEST FAILED ===" && cat /tmp/tailwind-test.css 2>/dev/null && exit 1)

RUN npm run build > /tmp/build.log 2>&1 || (cat /tmp/build.log && exit 1)

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
