# syntax=docker/dockerfile:1.7
ARG NODE_ENV=production

FROM node:22-alpine AS deps
ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --legacy-peer-deps

FROM node:22-alpine AS build
ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --legacy-peer-deps --include=dev
COPY . .
RUN npm run build

FROM node:22-alpine AS run
ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
USER node
CMD ["node", "server.js"]
