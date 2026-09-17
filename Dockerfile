# Build (npm ci + tsc → dist, обрезка до prod-зависимостей) → runtime без исходников.
# npm ci один, без параллельной prod-установки: на 2 ГБ параллельные npm падали.

FROM node:22-alpine AS build
WORKDIR /app
# Манифесты раньше кода: слой npm ci кэшируется
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Непривилегированный пользователь: контейнер не root
USER node
EXPOSE 5001
CMD ["node", "dist/index.js"]
