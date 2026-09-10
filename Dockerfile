# Multi-stage образ Express-бэкенда my-budget.
# Стадия build: npm ci (включая dev-зависимости typescript/tsc-alias), компиляция
# TS → dist/ и обрезка node_modules до prod-зависимостей. npm ci один и без
# параллельной prod-установки: на сервере 2 ГБ параллельные npm падали с
# «Exit handler never called!». Стадия runtime: node_modules и dist из build-стадии,
# исходники и тулчейн в финальный образ не попадают.

FROM node:22-alpine AS build
WORKDIR /app
# Копируем манифесты до кода: слой npm ci кэшируется пока зависимости не менялись
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
# Встроенный непривилегированный пользователь образов node — контейнер не root
USER node
EXPOSE 5001
CMD ["node", "dist/index.js"]
