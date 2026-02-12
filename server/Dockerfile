FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json *.ts ./
RUN npx tsc
CMD ["node", "dist/relay.js"]
