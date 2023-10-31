FROM node:20-alpine as build
WORKDIR /app
COPY package.json yarn.lock ./

RUN yarn

# Bundle app source
COPY . .

RUN yarn build

FROM node:20-alpine

ENV PORT=8080
EXPOSE $PORT
WORKDIR /app

RUN apk add git python3 make g++

COPY --chown=node:node --from=build /app/node_modules node_modules
COPY --chown=node:node --from=build /app/dist dist
COPY --chown=node:node --from=build /app/package.json ./

USER node

CMD ["node", "dist/index.js"]
