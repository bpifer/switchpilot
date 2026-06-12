FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY src/cisco/capabilities.json ./dist/cisco/capabilities.json
# Data dirs must be owned by the runtime user; named volumes inherit image ownership on first create
RUN mkdir -p /data/firmware /data/config-history && chown -R node:node /data
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
