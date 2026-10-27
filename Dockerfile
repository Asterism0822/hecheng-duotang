FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY public ./public

ENV PORT=3000
EXPOSE 3000

# 纯静态托管，没有任何需要持久化的数据
CMD ["node", "server.mjs"]
