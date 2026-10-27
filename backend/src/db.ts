// IMPORTANT: DO NOT MODIFY THIS FILE AT ALL
// This file is used to initialize the Prisma client and the SQLite database.
// ============================================
// Prisma Database Client
// ============================================
// This is a singleton instance of the Prisma client
// Used throughout the application for database operations
//
// Usage:
//   import { db } from "./db";
//   const users = await db.user.findMany();
//
// The Prisma schema is located at prisma/schema.prisma
// After modifying the schema, run: bunx prisma generate
import { PrismaClient } from "../generated/prisma";

const prismaClient = new PrismaClient();

async function initSqlitePragmas(prisma: PrismaClient) {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000;");
  await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
  await prisma.$queryRawUnsafe("PRAGMA cache_size = -32768;");
  await prisma.$queryRawUnsafe("PRAGMA temp_store = MEMORY;");
  await prisma.$queryRawUnsafe("PRAGMA optimize;");
}
initSqlitePragmas(prismaClient);

export const db = prismaClient;
