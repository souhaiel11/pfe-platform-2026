FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build 2>/dev/null || npx @nestjs/cli build || true
EXPOSE 3000
CMD ["node", "dist/main.js"]
