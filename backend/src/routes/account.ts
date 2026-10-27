import { Hono } from "hono";
import { type AppType } from "../types";
import { db } from "../db";

const accountRouter = new Hono<AppType>();

// ============================================
// DELETE /api/account/delete - Delete user account
// ============================================
accountRouter.delete("/delete", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    console.log(`🗑️ Deleting user account and all data: ${user.id}`);

    // Prisma cascades handle deleting all related data automatically
    await db.user.delete({ where: { id: user.id } });

    console.log(`✅ Successfully deleted user account: ${user.id}`);
    return c.json({ success: true, message: "Account deleted successfully" }, 200);
  } catch (error: any) {
    console.error("❌ Account deletion error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { accountRouter };
