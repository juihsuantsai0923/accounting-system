FROM node:20-slim

WORKDIR /app

# better-sqlite3 需要編譯原生模組，裝一下編譯工具
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/data

EXPOSE 4000

# /app/data 掛載成部署平台的持久化磁碟（Volume），資料庫檔案才不會每次部署都被清空
VOLUME ["/app/data"]

CMD ["npm", "start"]
