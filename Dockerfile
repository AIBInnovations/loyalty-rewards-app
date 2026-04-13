FROM node:20-slim

WORKDIR /app

# Install build tools needed for native addons (sharp, onnxruntime-node)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "run", "start"]
