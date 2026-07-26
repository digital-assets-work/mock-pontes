# syntax=docker/dockerfile:1

# ---- Build stage: install all deps and produce the bundled dist ----
FROM node:24 AS builder

LABEL org.opencontainers.image.title="mock-pontes"
LABEL org.opencontainers.image.description="Stateful mock of the ECB Pontes (TARGET) A2A API for local development and testing"
LABEL org.opencontainers.image.source="https://github.com/digital-assets-work/mock-pontes"
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources and build. The build bundles app code with esbuild
# (`--packages=external`), so runtime node_modules are still required.
COPY . .
RUN npm run build

# ---- Deps stage: production-only node_modules for the runtime image ----
FROM node:24 AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime stage: distroless node, minimal footprint ----
FROM gcr.io/distroless/nodejs24-debian12 AS runtime

# Change the user to nonroot (uid/gid 65532) defined in the distroless image
USER nonroot
WORKDIR /app

COPY --from=deps --chown=nonroot:nonroot /app/node_modules /app/node_modules
COPY --from=builder --chown=nonroot:nonroot /app/dist /app/dist

# Set a default port to 3001 and expose it
ENV PORT=3001
EXPOSE 3001

# Bind to all interfaces so the service is reachable from outside the container.
ENV HOST=0.0.0.0

# Force node production environment
ENV NODE_ENV=production

# Add commit hash to image
ARG COMMIT_HASH
ENV PUBLIC_COMMIT_HASH=${COMMIT_HASH:-no_commit_hash}

ARG GIT_REF_NAME
ENV PUBLIC_GIT_REF_NAME=${GIT_REF_NAME:-no_ref_name}

ARG BUILD_DATETIME
ENV PUBLIC_BUILD_DATETIME=${BUILD_DATETIME:-no_build_datetime}

# Distroless images by default do not contain a shell. The Dockerfile ENTRYPOINT
# command must be specified in vector form. Also, the node binary is not in the PATH.
ENTRYPOINT ["/nodejs/bin/node", "./dist/index.js"]
