FROM node:20-slim

WORKDIR /app

# sharp requires libvips; the npm package ships prebuilt binaries for linux-x64
# but apt-get ensures dependencies are present if a source build is needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Install all dependencies (devDeps needed for the Remix build step)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Drop devDependencies to shrink the final image
RUN npm prune --omit=dev

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "run", "start"]
