FROM oven/bun:1

WORKDIR /app/backend

# Copy shared module one level up (mirrors local monorepo structure)
COPY shared ../shared

# Copy backend package files and prisma schema
COPY backend/package.json backend/bun.lock* ./
COPY backend/prisma ./prisma

# Install backend dependencies
RUN bun install

# Symlink node_modules to /app so shared/contracts.ts can resolve "zod" etc.
RUN ln -s /app/backend/node_modules /app/node_modules

# Copy and build backend source
COPY backend/src ./src
COPY backend/tsconfig.json ./tsconfig.json
RUN bun run build

EXPOSE 3000

CMD ["sh", "-c", "bunx prisma db push && bun run dist/index.js"]
