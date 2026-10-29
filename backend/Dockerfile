FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma
RUN bun install

COPY . .
RUN bun run build

EXPOSE 3000

CMD ["sh", "-c", "bunx prisma db push && bun run dist/index.js"]
