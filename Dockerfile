# Сервер «Грядки» + веб-версія в одному контейнері
FROM node:22-alpine AS web
WORKDIR /src/app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /srv
COPY server/ ./server/
COPY --from=web /src/app/dist ./web
ENV STATIC_DIR=/srv/web \
    DATA_DIR=/data \
    PORT=8787 \
    NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "server/server.mjs"]
