# Multi-stage образ Express-бэкенда my-budget.
# Стадия build: npm ci (включая dev-зависимости typescript/tsc-alias) и
# компиляция TS → dist/. Стадия runtime: только prod-зависимости и dist,
# исходники и тулчейн в финальный образ не попадают.

FROM node:22-alpine AS build
WORKDIR /app
# Копируем манифесты до кода: слой npm ci кэшируется пока зависимости не менялись
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Встроенный непривилегированный пользователь образов node — контейнер не root
USER node
EXPOSE 5001
CMD ["node", "dist/index.js"]
