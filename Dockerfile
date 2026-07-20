FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_EN_NAME
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
ENV NODE_OPTIONS=--max-old-space-size=4096

RUN npm run build

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", ".next/standalone/server.js"]
