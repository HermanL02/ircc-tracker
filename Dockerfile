# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 BROWSER_PROFILE_DIR=/data/browser-profile
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Google Chrome (via Playwright, matching its version) plus Xvfb: GCKey's hCaptcha
# rejects headless browsers, so Chrome runs headed on a virtual display.
RUN npx playwright install --with-deps chrome \
  && apt-get install -y --no-install-recommends xvfb xauth fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/browser-profile && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x900x24", "node", "dist/main.js"]
