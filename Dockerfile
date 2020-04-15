FROM node:13 as builder

WORKDIR /home/node/app

ADD package.json /home/node/app/package.json
ADD yarn.lock /home/node/app/yarn.lock
RUN yarn

ADD . /home/node/app
RUN yarn build && rm -rf node_modules

FROM node:13-alpine as runner

WORKDIR /home/node/app

COPY --from=builder /home/node/app/package.json /home/node/app/package.json
COPY --from=builder /home/node/app/yarn.lock /home/node/app/yarn.lock
RUN yarn --production

COPY --from=builder /home/node/app/dist /home/node/app/dist
COPY --from=builder /home/node/app/api /home/node/app/api

RUN apk add git python make g++

ENV PORT=8080
EXPOSE 8080

CMD yarn start

