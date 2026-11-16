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

COPY --from=build --chown=apprunner:nodejs /app/tsconfig.json ./tsconfig.json
# server.ts imports this at runtime under node type stripping; it has no
# imports of its own, so the single source file is all the runner needs.
COPY --from=build --chown=apprunner:nodejs /app/app/lib/env.server.ts ./app/lib/env.server.ts

USER apprunner

EXPOSE 3000

# Probe the app's own health endpoint so the orchestrator can restart a wedged
# container. `node -e` avoids adding curl/wget to the runtime image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.ts"]
