# =============================================================================
# Stage 1: Install dependencies (cached via package.json + lockfile)
# =============================================================================
FROM node:22-alpine AS deps
WORKDIR /app

# Copy only the dependency manifests first — this layer is cached until
# package.json or package-lock.json changes.
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

# =============================================================================
# Stage 2: Build the application
# =============================================================================
FROM node:22-alpine AS build
WORKDIR /app

# Copy cached node_modules from deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy the rest of the source. This layer busts on every source change but
# the expensive npm ci step above is already cached.
COPY . .

# Build: React Router compiles server + client bundles into build/.
RUN npm run build

# Remove dev dependencies — they are not needed at runtime.
RUN npm prune --omit=dev

# =============================================================================
# Stage 3: Production runtime
# =============================================================================
FROM node:22-alpine AS runner
WORKDIR /app

# Use a non-root user for security.
RUN addgroup --system --gid 1001 nodejs && \
	adduser --system --uid 1001 apprunner

# Copy only what is needed at runtime.
COPY --from=build --chown=apprunner:nodejs /app/build ./build
COPY --from=build --chown=apprunner:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=apprunner:nodejs /app/server.ts ./server.ts
COPY --from=build --chown=apprunner:nodejs /app/package.json ./package.json

# Copy the PocketBase schema setup script for post-deploy execution.
COPY --from=build --chown=apprunner:nodejs /app/scripts/setup-pb.ts ./scripts/setup-pb.ts
COPY --from=build --chown=apprunner:nodejs /app/tsconfig.json ./tsconfig.json

USER apprunner

EXPOSE 3000

CMD ["node", "server.ts"]

