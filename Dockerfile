# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev

# App source.
COPY src ./src
COPY public ./public

# Persistent datastore lives here; mount a volume in production.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/index.js"]
