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

export const db = prismaClient;
