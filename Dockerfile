ARG NODE_VERSION=22-alpine

# -------- deps stage (cache npm install) --------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
	npm ci --include=dev

# -------- build stage --------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
	&& npm prune --omit=dev

# -------- runtime stage --------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	HELLO_CONFIG=/config/config.json

# Astro's node adapter standalone output + pruned production deps.
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Config lives on a mounted volume. Seed with the example so a fresh
# deploy doesn't 404 before the user edits it.
RUN mkdir -p /config
COPY config/config.example.json /config/config.example.json

EXPOSE 3000

# Drop to the built-in non-root `node` user. /config must be writable by
# the host user you mount from; this container only reads it.
USER node

CMD ["node", "./dist/server/entry.mjs"]
