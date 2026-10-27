import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import Papa from "papaparse";
import { type AppType } from "../types";
import { db } from "../db";

const csvImportRouter = new Hono<AppType>();

// ============================================
// Auth middleware for CSV import routes
// ============================================
csvImportRouter.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// ============================================
// POST /api/csv-import/content-ideas
// ============================================
// Import content ideas from CSV
// Expected CSV columns: idea, hook, caption, call to action, format, categories
csvImportRouter.post(
  "/content-ideas",
  zValidator("json", z.object({ csvContent: z.string() })),
  async (c) => {
    const user = c.get("user")!;
    const { csvContent } = c.req.valid("json");

    try {
      console.log(
        `📥 [CSV Import] Starting content ideas import for user: ${user.id}`
      );

      // Parse CSV using papaparse
      const parseResult = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
      });

      if (parseResult.errors.length > 0) {
        console.error("❌ [CSV Import] CSV parsing errors:", parseResult.errors);
        return c.json(
          {
            error: "Invalid CSV format",
            details: parseResult.errors,
          },
          400
        );
      }

      const rows = parseResult.data as Record<string, string>[];

      if (rows.length === 0) {
        console.log("⚠️  [CSV Import] No data rows found in CSV");
        return c.json({ error: "No data rows found in CSV" }, 400);
      }

      // Validate and transform rows
      const today: string = new Date().toISOString().split("T")[0] || "";
      const contentIdeas: Array<{
        userId: string;
        text: string;
        hook: string | null;
        description: string | null;
        cta: string | null;
        category: string;
        scheduledDate: string;
        status: string;
        inspirations: null;
        isELLYGenerated: boolean;
        generatedBy: null;
        suggestedDate: null;
        generationPrompt: null;
        generationModel: null;
      }> = [];

      for (const row of rows) {
        // Normalize column names (handle different case variations)
        const normalizedRow: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
          const lowerKey = key?.toLowerCase?.().trim() || "";
          normalizedRow[lowerKey] = value || "";
        }

        // Extract fields with fallbacks for common variations
        const idea =
          normalizedRow["idea"] ||
          normalizedRow["content idea"] ||
          normalizedRow["text"] ||
          "";
        const hook = normalizedRow["hook"] || "";
        const caption =
          normalizedRow["caption"] ||
          normalizedRow["description"] ||
          "";
        const cta =
          normalizedRow["call to action"] ||
          normalizedRow["cta"] ||
          normalizedRow["call-to-action"] ||
          "";
        const format =
          normalizedRow["format"] ||
          normalizedRow["category"] ||
          normalizedRow["type"] ||
          "";
        const categories =
          normalizedRow["categories"] ||
          normalizedRow["category"] ||
          normalizedRow["format"] ||
          "";

        // Skip rows with no main content
        if (!idea.trim()) {
          console.warn("⚠️  [CSV Import] Skipping row: no idea/content");
          continue;
        }

        contentIdeas.push({
          userId: user.id,
          text: idea.trim(),
          hook: hook.trim() || null,
          description: caption.trim() || null,
          cta: cta.trim() || null,
          category: (format || categories).trim() || "Reels",
          scheduledDate: today,
          status: "planned",
          inspirations: null,
          isELLYGenerated: false,
          generatedBy: null,
          suggestedDate: null,
          generationPrompt: null,
          generationModel: null,
        });
      }

      if (contentIdeas.length === 0) {
        console.log("⚠️  [CSV Import] No valid content ideas found");
        return c.json(
          { error: "No valid content ideas found in CSV" },
          400
        );
      }

      console.log(
        `📝 [CSV Import] Creating ${contentIdeas.length} content ideas...`
      );

      // Batch insert using createMany
      const created = await db.contentIdea.createMany({
        data: contentIdeas,
      });

      console.log(
        `✅ [CSV Import] Successfully imported ${created.count} content ideas`
      );

      return c.json({
        success: true,
        imported: created.count,
        total: rows.length,
        skipped: rows.length - created.count,
        message: `Successfully imported ${created.count} content ideas`,
      });
    } catch (error) {
      console.error("❌ [CSV Import] Error importing content ideas:", error);
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return c.json(
        {
          error: "Failed to import content ideas",
          details: message,
        },
        500
      );
    }
  }
);

export { csvImportRouter };
