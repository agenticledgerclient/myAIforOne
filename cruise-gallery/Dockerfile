FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Railway mounts a volume at /data — photos go there
RUN mkdir -p /data/photos

EXPOSE 3000

CMD ["node", "server.js"]
