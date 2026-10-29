FROM oven/bun:1

WORKDIR /app

# Copy shared module first (needed for @/shared/* imports)
COPY shared ./shared

# Copy backend
COPY backend/package.json backend/bun.lock* ./backend/
COPY backend/prisma ./backend/prisma
WORKDIR /app/backend
RUN bun install

COPY backend/src ./src
COPY backend/tsconfig.json ./tsconfig.json
RUN bun run build

EXPOSE 3000

CMD ["sh", "-c", "bunx prisma db push && bun run dist/index.js"]
