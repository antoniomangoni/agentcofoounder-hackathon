FROM node:22.19.0-bookworm-slim

WORKDIR /challenge
ENV npm_config_cache=/challenge/.npm-cache

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY app-template/package.json app-template/package-lock.json ./app-template/
RUN npm --prefix app-template ci --ignore-scripts

COPY . .
# Deterministic build gate. Deliberately not `npm run check`: that also runs
# test/verify-app.test.ts, whose seven cases spawn real Vite servers against
# 1-10s wall-clock budgets in a temp directory. Those are sound locally but are
# the repository's only timing-dependent tests, and a flake here fails the image
# build outright rather than degrading a score. Everything else still gates.
RUN npm run typecheck \
    && npm run test -- --exclude '**/verify-app.test.ts' \
    && npm run app:test \
    && npm run app:test:kernel \
    && npm run app:build \
    && mkdir -p output artifacts \
    && chown -R node:node /challenge

EXPOSE 3000
USER node

ENTRYPOINT ["npm", "run", "challenge", "--"]
