import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";

import { auth } from "./auth";
import { env } from "./env";
import { uploadRouter } from "./routes/upload";
import { sampleRouter } from "./routes/sample";
import { syncRouter } from "./routes/sync";
import { accountRouter } from "./routes/account";
import { aiRouter, checkAIHealth } from "./routes/ai";
import { csvImportRouter } from "./routes/csvImport";
import { type AppType } from "./types";

// AppType context adds user and session to the context, will be null if the user or session is null
const app = new Hono<AppType>();

console.log("🔧 Initializing Hono application...");
app.use("*", logger());
app.use(
  "/*",
  cors({
    origin: (origin) => origin || "*", // Allow the requesting origin or fallback to *
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

/** Authentication middleware
 * Extracts session from request headers and attaches user/session to context
 * All routes can access c.get("user") and c.get("session")
 */
app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", session?.user ?? null); // type: typeof auth.$Infer.Session.user | null
  c.set("session", session?.session ?? null); // type: typeof auth.$Infer.Session.session | null
  return next();
});

// Better Auth handler
// Handles all authentication endpoints: /api/auth/sign-in, /api/auth/sign-up, etc.
console.log("🔐 Mounting Better Auth handler at /api/auth/*");
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Serve uploaded images statically
// Files in uploads/ directory are accessible at /uploads/* URLs
console.log("📁 Serving static files from uploads/ directory");
app.use("/uploads/*", serveStatic({ root: "./" }));

// Mount route modules
console.log("📤 Mounting upload routes at /api/upload");
app.route("/api/upload", uploadRouter);

console.log("📝 Mounting sample routes at /api/sample");
app.route("/api/sample", sampleRouter);

console.log("🔄 Mounting sync routes at /api/sync");
app.route("/api/sync", syncRouter);

console.log("👤 Mounting account routes at /api/account");
app.route("/api/account", accountRouter);

console.log("🤖 Mounting AI routes at /api/ai");
app.route("/api/ai", aiRouter);

console.log("📥 Mounting CSV import routes at /api/csv-import");
app.route("/api/csv-import", csvImportRouter);

// TEMPORARY: public provider check; remove after production verification.
app.get("/api/health/ai", async (c) => c.json(await checkAIHealth()));

// Health check endpoint
// Used by load balancers and monitoring tools to verify service is running
app.get("/health", (c) => {
  console.log("💚 Health check requested");
  return c.json({ status: "ok" });
});

// Start the server
console.log("⚙️  Starting server...");
serve({ fetch: app.fetch, port: Number(env.PORT) }, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📍 Environment: ${env.NODE_ENV}`);
  console.log(`🚀 Server is running on port ${env.PORT}`);
  console.log(`🔗 Base URL: http://localhost:${env.PORT}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n📚 Available endpoints:");
  console.log("  🔐 Auth:     /api/auth/*");
  console.log("  📤 Upload:   POST /api/upload/image");
  console.log("  📝 Sample:   GET/POST /api/sample");
  console.log("  🔄 Sync:     GET /api/sync/all, PUT /api/sync/profile, PUT /api/sync/app-data, PUT /api/sync/wellness");
  console.log("  👤 Account:  DELETE /api/account/delete");
  console.log("  🤖 AI:       POST /api/ai/chat, /ideas, /analyze, /viral-score, /extract-script, /transcribe, /image");
  console.log("  📥 CSV:      POST /api/csv-import/content-ideas");
  console.log("  💚 Health:   GET /health");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
});
