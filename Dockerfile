# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --legacy-peer-deps && \
    npm cache clean --force

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
USER node
CMD ["node", "server.js"]
