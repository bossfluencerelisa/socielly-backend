import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  type GetSampleResponse,
  postSampleRequestSchema,
  type PostSampleResponse,
} from "@/shared/contracts";
import { type AppType } from "../types";

// Sample routes demonstrating common patterns
// These serve as examples for building your own API endpoints
const sampleRouter = new Hono<AppType>();

// ============================================
// GET /api/sample - Public endpoint
// ============================================
// Example of a simple public endpoint that anyone can access
// No authentication required
sampleRouter.get("/", (c) => {
  console.log("📝 [Sample] Public GET request received");
  return c.json({ message: "Hello, world!" } satisfies GetSampleResponse);
});

// ============================================
// GET /api/sample/protected - Protected endpoint
// ============================================
// Example of a protected endpoint that requires authentication
// Returns 401 if user is not logged in
sampleRouter.get("/protected", (c) => {
  const user = c.get("user");
  console.log("🔒 [Sample] Protected GET request received");

  if (!user) {
    console.log("❌ [Sample] Unauthorized access attempt - no user session");
    return c.json({ message: "Unauthorized" }, 401);
  }

  console.log(`✅ [Sample] Authorized access by user: ${user.email || user.id}`);
  return c.json({ message: "Hello, world!" } satisfies GetSampleResponse);
});

// ============================================
// POST /api/sample - Sample POST with validation
// ============================================
// Example of a POST endpoint with Zod validation
// Request body must match postSampleRequestSchema
// Try sending: { "value": "ping" } to get "pong" response
sampleRouter.post("/", zValidator("json", postSampleRequestSchema), async (c) => {
  const { value } = c.req.valid("json"); // Fully type-safe input value
  console.log(`📝 [Sample] POST request received with value: "${value}"`);

  if (value === "ping") {
    console.log("🏓 [Sample] Ping-pong response triggered");
    return c.json({ message: "pong" });
  }

  console.log("📤 [Sample] Returning default response");
  return c.json({ message: "Hello, world!" } satisfies PostSampleResponse);
});

export { sampleRouter };
