FROM node:22-slim

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

RUN npm ci --omit=dev

# Copy source
COPY . .

# Ensure data directory exists (will be overridden by volume mount at runtime)
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "src/index.js"]
