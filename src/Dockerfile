# server/Dockerfile
FROM node:20-alpine

# 1) Bağımlılıkları kur (server/ altında)
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# 2) Uygulama kodunu kopyala
COPY server ./

# 3) Çalışma dizinini app.js'in olduğu yere al
WORKDIR /app/server/src

ENV NODE_ENV=production
# Fly PORT=3000 verecek; app.js zaten 0.0.0.0 dinliyor
EXPOSE 3000

# 4) Uygulamayı başlat
CMD ["node", "app.js"]
