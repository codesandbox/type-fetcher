FROM node:20-alpine as base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    pnpm install --prod --frozen-lockfile

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    pnpm install --frozen-lockfile
COPY . /app
RUN pnpm run build

FROM node:20-alpine

ENV PORT=8080
EXPOSE $PORT
WORKDIR /app

RUN apk add git python3 make g++

COPY --from=prod-deps /app/node_modules node_modules
COPY --chown=node:node --from=build /app/dist dist
COPY --chown=node:node --from=build /app/package.json ./

USER node

CMD ["node", "dist/index.js"]
