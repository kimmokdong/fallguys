FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# 서버는 three의 빌드 파일 두 개만 제공하므로 예제·소스는 이미지에서 뺍니다.
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && find node_modules/three -mindepth 1 -maxdepth 1 ! -name build ! -name package.json -exec rm -rf {} + \
  && find node_modules/three/build -type f ! -name three.module.js ! -name three.core.js -delete
COPY server.js http-assets.js ./
COPY public ./public
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server.js"]
