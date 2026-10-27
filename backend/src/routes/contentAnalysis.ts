import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  postContentAnalysisRequestSchema,
  type PostContentAnalysisResponse,
  type ContentAnalysis,
  type ViralScore,
} from "@/shared/contracts";
import { type AppType } from "../types";
import { env } from "../env";

const analysisRouter = new Hono<AppType>();

// Initialize Anthropic client
const backendKey = process.env.BACKEND_ANTHROPIC_API_KEY;
const anthropic = new Anthropic({
  apiKey: backendKey || process.env.ANTHROPIC_API_KEY,
  baseURL: backendKey ? "https://api.anthropic.com" : process.env.ANTHROPIC_BASE_URL,
  defaultHeaders: env.ANTHROPIC_WORKSPACE_ID
    ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

// Helper to validate Supabase JWT and get user ID
async function getSupabaseUserId(authHeader: string | undefined): Promise<string | null> {
  console.log(`[contentAnalysis.ts] 🔍 Checking Supabase JWT: header=${!!authHeader}`);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log(`[contentAnalysis.ts] ❌ No Bearer token found`);
    return null;
  }
  const token = authHeader.replace("Bearer ", "");

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.log(`[contentAnalysis.ts] ❌ Missing Supabase config`);
    return null;
  }

  try {
    const supabaseClient = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabaseClient.auth.getUser(token);
    if (error || !data?.user) {
      console.log(`[contentAnalysis.ts] ❌ Supabase error`);
      return null;
    }
    console.log(`[contentAnalysis.ts] ✅ User found`);
    return data.user.id;
  } catch (error) {
    console.log(`[contentAnalysis.ts] ❌ Exception:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

// Generate viral score using Claude
async function generateViralScore(
  contentDescription: string,
  script?: string
): Promise<ViralScore> {
  const analysisPrompt = `Analyze the following content and generate a viral score.

${script ? `Script/Content: ${script}` : `Content Description: ${contentDescription}`}

Generate a viral score based on:
1. Hook Clarity (1-10): How clear and compelling is the hook?
2. Storytelling Structure (1-10): How well is the story structured?
3. Retention Potential (1-10): How likely is it to keep viewers engaged?
4. Uniqueness (1-10): How original and unique is the content?
5. Emotional Impact (1-10): How emotionally resonant is it?

Then calculate an overall score (1-100) as the average of these factors.
Also provide one specific actionable improvement suggestion.

Return ONLY valid JSON (no markdown) in this exact format:
{
  "score": <1-100>,
  "hookClarity": <1-10>,
  "storytelling": <1-10>,
  "retentionPotential": <1-10>,
  "uniqueness": <1-10>,
  "emotionalImpact": <1-10>,
  "improvements": "One specific actionable improvement suggestion for creators"
}`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: analysisPrompt,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const responseText = textBlock && textBlock.type === "text" ? textBlock.text : "{}";

  try {
    // Remove markdown code blocks if present
    let cleanJson = responseText;
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/```json?\n?/g, "").replace(/```/g, "");
    }
    const parsed = JSON.parse(cleanJson);
    return {
      score: Math.min(100, Math.max(1, parsed.score || 50)),
      hookClarity: Math.min(10, Math.max(1, parsed.hookClarity || 5)),
      storytelling: Math.min(10, Math.max(1, parsed.storytelling || 5)),
      retentionPotential: Math.min(10, Math.max(1, parsed.retentionPotential || 5)),
      uniqueness: Math.min(10, Math.max(1, parsed.uniqueness || 5)),
      emotionalImpact: Math.min(10, Math.max(1, parsed.emotionalImpact || 5)),
      improvements: parsed.improvements || "Focus on clearer hook and better story structure",
    };
  } catch {
    console.log("[contentAnalysis] Failed to parse viral score, returning defaults");
    return {
      score: 50,
      hookClarity: 5,
      storytelling: 5,
      retentionPotential: 5,
      uniqueness: 5,
      emotionalImpact: 5,
      improvements: "Focus on hook clarity, storytelling structure, and emotional resonance",
    };
  }
}

// Analyze image content with Claude vision
async function analyzeImage(imageBase64: string): Promise<ContentAnalysis> {
  const analysisPrompt = `Analyze this image from a social media content creator's perspective.

Provide analysis on:
1. Hook Analysis: What's the visual hook? How effective is it?
2. Layout and Hierarchy: How is the content structured visually?
3. Visual Hierarchy: What elements draw attention first?
4. Optimization Potential: How could this be improved for social media performance?
5. Aspect Ratio: Identify the original aspect ratio
6. Key Insights: What works well and what could be improved?

Return ONLY valid JSON (no markdown) in this exact format:
{
  "type": "image",
  "hookAnalysis": "Analysis of visual hook and effectiveness",
  "structure": "Content structure and layout analysis",
  "visualAnalysis": "Visual hierarchy, design elements, and optimization recommendations",
  "creatorSuggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"],
  "keyInsights": ["Insight 1", "Insight 2"],
  "aspectRatio": "Detected aspect ratio (e.g., 9:16, 1:1, 16:9)"
}`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: analysisPrompt,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const responseText = textBlock && textBlock.type === "text" ? textBlock.text : "{}";

  try {
    let cleanJson = responseText;
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/```json?\n?/g, "").replace(/```/g, "");
    }
    const parsed = JSON.parse(cleanJson);
    return {
      type: "image",
      hookAnalysis: parsed.hookAnalysis || "Hook analysis not available",
      structure: parsed.structure || "Structure analysis not available",
      visualAnalysis: parsed.visualAnalysis || "Visual analysis not available",
      creatorSuggestions: parsed.creatorSuggestions || [],
      keyInsights: parsed.keyInsights || [],
      aspectRatio: parsed.aspectRatio || "Unknown",
    };
  } catch {
    console.log("[contentAnalysis] Failed to parse image analysis");
    return {
      type: "image",
      hookAnalysis: "Unable to analyze hook",
      structure: "Unable to analyze structure",
      visualAnalysis: "Unable to analyze visuals",
      creatorSuggestions: [],
      keyInsights: [],
      aspectRatio: "Unknown",
    };
  }
}

// Fetch and parse social media link content
async function fetchLinkContent(url: string, platform?: string): Promise<string> {
  try {
    console.log(`[contentAnalysis] Fetching content from: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.log(`[contentAnalysis] Failed to fetch URL, status: ${response.status}`);
      return `Unable to fetch content from ${platform || "this"} link. URL: ${url}`;
    }

    const html = await response.text();

    // Extract metadata from HTML
    let metadata = {
      title: "",
      description: "",
      caption: "",
      ogImage: "",
      ogVideo: "",
      text: "",
    };

    // Extract Open Graph metadata
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogTitleMatch && ogTitleMatch[1]) metadata.title = ogTitleMatch[1];

    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
    if (ogDescMatch && ogDescMatch[1]) metadata.description = ogDescMatch[1];

    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogImageMatch && ogImageMatch[1]) metadata.ogImage = ogImageMatch[1];

    const ogVideoMatch = html.match(/<meta\s+property=["']og:video["']\s+content=["']([^"']+)["']/i);
    if (ogVideoMatch && ogVideoMatch[1]) metadata.ogVideo = ogVideoMatch[1];

    // For Instagram/TikTok specific extraction
    if (platform === "instagram" || url.includes("instagram.com")) {
      // Look for Instagram-specific meta content
      const instaDataMatch = html.match(/<script\s+type=["']application\/ld\+json["']>([^<]+)<\/script>/i);
      if (instaDataMatch && instaDataMatch[1]) {
        try {
          const instaData = JSON.parse(instaDataMatch[1]);
          if (instaData.description) metadata.description = instaData.description;
          if (instaData.text) metadata.text = instaData.text;
        } catch {
          console.log("[contentAnalysis] Failed to parse Instagram JSON-LD data");
        }
      }
    }

    // Compile the extracted content
    let extractedContent = `Content from ${platform || "social media"} link:\n`;
    if (metadata.title) extractedContent += `Title: ${metadata.title}\n`;
    if (metadata.description) extractedContent += `Description: ${metadata.description}\n`;
    if (metadata.caption) extractedContent += `Caption: ${metadata.caption}\n`;
    if (metadata.text) extractedContent += `Text: ${metadata.text}\n`;

    if (!metadata.title && !metadata.description && !metadata.caption && !metadata.text) {
      extractedContent += `Note: Limited metadata available. Please provide more context about the video content.\n`;
      extractedContent += `Platform: ${platform || "Unknown"}\nURL: ${url}`;
    }

    console.log(`[contentAnalysis] Extracted content length: ${extractedContent.length}`);
    return extractedContent;
  } catch (error) {
    console.log(`[contentAnalysis] Error fetching link:`, error instanceof Error ? error.message : String(error));
    return `Unable to fetch content from ${url}. Please describe the video content or paste the script directly.`;
  }
}

// Analyze social media links
async function analyzeLink(url: string, platform?: string): Promise<ContentAnalysis> {
  // First, fetch the actual content from the link
  const linkContent = await fetchLinkContent(url, platform);
  const platformStr = platform || "unknown";

  const analysisPrompt = `Analyze this social media content and provide insights for a content creator.

${linkContent}

Based on the information available, please:
1. Extract or summarize the script/content (if available)
2. Rewrite the script in a creator-friendly format
3. Analyze the hook - how effective is it?
4. Analyze the content structure and flow
5. Provide specific, actionable suggestions for improvement

If the content is limited or metadata-only, analyze what IS available and suggest improvements based on best practices.

Return ONLY valid JSON (no markdown) in this exact format:
{
  "type": "link",
  "platform": "${platformStr}",
  "script": "Extracted or summarized script/content (or description of what the content contains)",
  "scriptSummary": "Creator-friendly rewritten version or key takeaways",
  "hookAnalysis": "Analysis of the hook effectiveness based on available info",
  "structure": "Content structure and flow analysis",
  "creatorSuggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"],
  "keyInsights": ["Insight 1", "Insight 2"]
}`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: analysisPrompt,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const responseText = textBlock && textBlock.type === "text" ? textBlock.text : "{}";

  try {
    let cleanJson = responseText;
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/```json?\n?/g, "").replace(/```/g, "");
    }
    const parsed = JSON.parse(cleanJson);

    // Generate viral score based on script
    const viralScore = await generateViralScore(parsed.scriptSummary || parsed.script || linkContent);

    return {
      type: "link",
      platform: platformStr,
      script: parsed.script || "Script not available",
      scriptSummary: parsed.scriptSummary || "Summary not available",
      hookAnalysis: parsed.hookAnalysis || "Hook analysis not available",
      structure: parsed.structure || "Structure analysis not available",
      creatorSuggestions: parsed.creatorSuggestions || [],
      keyInsights: parsed.keyInsights || [],
      viralScore,
    };
  } catch {
    console.log("[contentAnalysis] Failed to parse link analysis");
    return {
      type: "link",
      platform: platformStr,
      script: "Unable to extract script - please provide more details",
      scriptSummary: "Could not generate summary from available metadata",
      hookAnalysis: "Unable to analyze hook - limited content available",
      structure: "Unable to analyze structure",
      creatorSuggestions: ["Share the video script or transcript", "Describe the visual sequence", "Provide the voiceover text"],
      keyInsights: ["Consider uploading the video or describing its content for better analysis"],
    };
  }
}

// Analyze files (PDFs, documents, text files)
async function analyzeFile(fileBase64: string, fileName?: string): Promise<ContentAnalysis> {
  const analysisPrompt = `Analyze this file content ${fileName ? `(${fileName})` : ""} and provide insights for content creators.

Extract:
1. Key insights and main points
2. Actionable ideas that creators can use
3. Structure and organization
4. Potential content opportunities
5. Improvement suggestions

Return ONLY valid JSON (no markdown) in this exact format:
{
  "type": "file",
  "keyInsights": ["Insight 1", "Insight 2", "Insight 3"],
  "structure": "Overall structure and organization",
  "creatorSuggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"],
  "contentOpportunities": ["Opportunity 1", "Opportunity 2"]
}`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: analysisPrompt,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const responseText = textBlock && textBlock.type === "text" ? textBlock.text : "{}";

  try {
    let cleanJson = responseText;
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/```json?\n?/g, "").replace(/```/g, "");
    }
    const parsed = JSON.parse(cleanJson);
    return {
      type: "file",
      keyInsights: parsed.keyInsights || [],
      structure: parsed.structure || "Structure not available",
      creatorSuggestions: parsed.creatorSuggestions || [],
      contentOpportunities: parsed.contentOpportunities || [],
    };
  } catch {
    console.log("[contentAnalysis] Failed to parse file analysis");
    return {
      type: "file",
      keyInsights: [],
      structure: "Unable to analyze structure",
      creatorSuggestions: [],
      contentOpportunities: [],
    };
  }
}

// POST /api/ai/analyze - Analyze content
analysisRouter.post(
  "/analyze",
  zValidator("json", postContentAnalysisRequestSchema),
  async (c) => {
    console.log("[/api/ai/analyze] ✅ REQUEST RECEIVED");

    const betterAuthUser = c.get("user");
    const supabaseUserId = !betterAuthUser
      ? await getSupabaseUserId(c.req.header("Authorization"))
      : null;

    const userId = betterAuthUser?.id || supabaseUserId;
    console.log("[/api/ai/analyze] User ID:", userId);

    if (!userId) {
      console.log("[/api/ai/analyze] ❌ Unauthorized");
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const { contentType, url, imageBase64, fileBase64, platform } = c.req.valid("json");

    try {
      let analysis: ContentAnalysis;

      if (contentType === "image" && imageBase64) {
        console.log("[/api/ai/analyze] 🖼️ Analyzing image");
        analysis = await analyzeImage(imageBase64);
      } else if (contentType === "link" && url) {
        console.log("[/api/ai/analyze] 🔗 Analyzing link");
        analysis = await analyzeLink(url, platform);
      } else if (contentType === "file" && fileBase64) {
        console.log("[/api/ai/analyze] 📄 Analyzing file");
        analysis = await analyzeFile(fileBase64);
      } else {
        return c.json(
          { success: false, error: "Invalid content type or missing required data" },
          400
        );
      }

      console.log("[/api/ai/analyze] ✅ Analysis complete");
      const result: PostContentAnalysisResponse = {
        success: true,
        analysis,
      };

      return c.json(result);
    } catch (error) {
      console.error("[/api/ai/analyze] ❌ ERROR:", error instanceof Error ? error.message : String(error));
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to analyze content" },
        500
      );
    }
  }
);

export { analysisRouter };
