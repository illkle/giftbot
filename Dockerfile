FROM --platform=linux/amd64 oven/bun:1 AS bun

FROM --platform=linux/amd64 lexiforest/curl-impersonate:latest

WORKDIR /app

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

CMD ["bun", "run", "start"]
