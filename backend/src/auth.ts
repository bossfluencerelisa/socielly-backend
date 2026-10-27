import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "./env";
import { db } from "./db";
// ============================================
// Better Auth Configuration
// ============================================
// Better Auth handles all authentication flows for the application
// Endpoints are automatically mounted at /api/auth/* in index.ts
//
// Available endpoints:
//   - POST /api/auth/sign-up/email       - Sign up with email/password
//   - POST /api/auth/sign-in/email       - Sign in with email/password
//   - POST /api/auth/sign-out            - Sign out current session
//   - GET  /api/auth/session             - Get current session
//   - And many more... (see Better Auth docs)
//
// This configuration includes:
//   - Prisma adapter for SQLite database
//   - Expo plugin for React Native support
//   - Email/password authentication
//   - Trusted origins for CORS
console.log("🔐 [Auth] Initializing Better Auth...");
export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "sqlite",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BACKEND_URL,
  plugins: [expo(), bearer()],
  trustedOrigins: [
    "vibecode://", // Expo app scheme (IMPORTANT: Update if you change app.json scheme)
    "http://localhost:3000",
    env.BACKEND_URL,
  ],
  emailAndPassword: {
    enabled: true,
  },
});
console.log("✅ [Auth] Better Auth initialized");
console.log(`🔗 [Auth] Base URL: ${env.BACKEND_URL}`);
const origins = auth.options.trustedOrigins;
console.log(`🌐 [Auth] Trusted origins: ${Array.isArray(origins) ? origins.join(", ") : "dynamic"}`);
