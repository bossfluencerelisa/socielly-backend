FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY prisma ./prisma
RUN bunx prisma generate

COPY . .
RUN bun run build

EXPOSE 3000

CMD ["sh", "-c", "bunx prisma db push && bun run dist/index.js"]
