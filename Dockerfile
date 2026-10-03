# syntax=docker/dockerfile:1

# ==============================================================================
# Kriya AI — Autonomous Operations Runtime & Omnitask Platform
# Multi-Stage Production Dockerfile
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Dependencies & Compile TypeScript
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native bindings if required
RUN apk add --no-cache python3 make g++

# Copy package manifests for workspace caching
COPY package*.json ./
COPY web/package*.json ./web/

# Install full dependencies (including devDependencies required for build)
RUN npm ci || npm install

# Copy configuration files and source code
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY web/ ./web/

# Compile backend TypeScript and copy SQL migrations to dist
RUN npm run build

# Compile web frontend bundle
RUN npm --prefix web run build

# Prune devDependencies to keep final production bundle lean
RUN npm prune --omit=dev

# ------------------------------------------------------------------------------
# Stage 2: Minimal Production Runtime
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

# Install wget for container healthcheck probes
RUN apk add --no-cache wget

# Set production environment defaults
ENV NODE_ENV=production \
    APP_MODE=production \
    PORT=3000 \
    HOST=0.0.0.0

# Set up non-root node user ownership
RUN chown -R node:node /app

# Copy production node_modules and root package manifest
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Copy compiled backend output (includes dist/storage/migrations)
COPY --from=builder --chown=node:node /app/dist ./dist

# Copy compiled frontend assets for web serving
COPY --from=builder --chown=node:node /app/web/dist ./web/dist

# Switch to unprivileged runtime user
USER node

# Expose HTTP service port
EXPOSE 3000

# Continuous liveness & readiness health probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Production bootloader
CMD ["node", "dist/index.js"]
