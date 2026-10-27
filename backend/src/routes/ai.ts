import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI, { toFile } from "openai";
import { createClient } from "@supabase/supabase-js";
import {
  postAIChatRequestSchema,
  postContentIdeasRequestSchema,
  postContentAnalysisRequestSchema,
  postViralScoreRequestSchema,
  postExtractScriptRequestSchema,
  postAITranscribeRequestSchema,
  type PostAIImageRequest,
  type PostAIImageResponse,
  type PostAIChatResponse,
  type PostContentIdeasResponse,
  type PostContentAnalysisResponse,
  type PostViralScoreResponse,
  type PostExtractScriptResponse,
  type PostAITranscribeResponse,
  type ChatMessage,
  type ContentAnalysis,
  type ViralScore,
  type ViralScoreDetailed,
} from "@/shared/contracts";
import { type AppType } from "../types";
import { env } from "../env";
import { randomUUID } from "crypto";
import { detectPlatform, transcribeSocialVideo } from "../services/videoTranscript";

const aiRouter = new Hono<AppType>();

// Initialize Anthropic client
// BACKEND_ANTHROPIC_API_KEY (set in backend/.env) takes priority over the Vibecode system env key.
// Explicitly set the direct API URL for a user-provided key. Passing undefined here lets the
// SDK silently reuse ANTHROPIC_BASE_URL, which can route requests through the wrong proxy.
const backendKey = process.env.BACKEND_ANTHROPIC_API_KEY;
const anthropic = new Anthropic({
  apiKey: backendKey || process.env.ANTHROPIC_API_KEY,
  baseURL: backendKey ? "https://api.anthropic.com" : process.env.ANTHROPIC_BASE_URL,
  defaultHeaders: env.ANTHROPIC_WORKSPACE_ID
    ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
  timeout: 45_000,
  maxRetries: 1,
});

// A direct OpenAI key must use OpenAI's endpoint, not the Vibecode proxy.
const openaiKey = process.env.OPENAI_API_KEY;
const openaiClient = new OpenAI({
  apiKey: openaiKey || "vibecode",
  baseURL: process.env.OPENAI_BASE_URL || (openaiKey
    ? "https://api.openai.com/v1"
    : "https://api.openai.com.proxy.vibecodeapp.com/v1"),
  timeout: 45_000,
  maxRetries: 1,
});

// TEMPORARY: public live check, cached to limit provider calls; remove after verification.
type AIHealth = { anthropic: "ok" | "fail"; openai: "ok" | "fail" };
let healthCache: { result: AIHealth; expiresAt: number } | undefined;
let healthInFlight: Promise<AIHealth> | undefined;

export async function checkAIHealth(): Promise<AIHealth> {
  if (healthCache && Date.now() < healthCache.expiresAt) return healthCache.result;
  if (healthInFlight) return healthInFlight;

  healthInFlight = (async () => {
    const [anthropicResult, openaiResult] = await Promise.allSettled([
      backendKey || process.env.ANTHROPIC_API_KEY
        ? anthropic.messages.create({
            model: "claude-sonnet-5-5",
            max_tokens: 1,
            messages: [{ role: "user", content: "ok" }],
          }, { timeout: 10_000, maxRetries: 0 })
        : Promise.reject(new Error("Claude not configured")),
      openaiKey
        ? openaiClient.models.retrieve("gpt-4", { timeout: 10_000, maxRetries: 0 })
        : Promise.reject(new Error("OpenAI not configured")),
    ]);
    const result: AIHealth = {
      anthropic: anthropicResult.status === "fulfilled" ? "ok" : "fail",
      openai: openaiResult.status === "fulfilled" ? "ok" : "fail",
    };
    healthCache = { result, expiresAt: Date.now() + 60_000 };
    return result;
  })();
  try {
    return await healthInFlight;
  } finally {
    healthInFlight = undefined;
  }
}

function logClaudeError(route: string, error: unknown): void {
  console.error(`${route} Claude request failed`, {
    status: error instanceof Anthropic.APIError ? error.status : undefined,
    workspaceConfiguration: error instanceof Anthropic.BadRequestError && /anthropic-workspace-id|not scoped to a workspace/i.test(error.message),
  });
}

function claudeServiceError(error: unknown): { message: string; status: 502 | 503 | 504 } {
  if (error instanceof Anthropic.BadRequestError && /anthropic-workspace-id|not scoped to a workspace/i.test(error.message)) {
    return { message: "Claude workspace is not configured. Please contact support.", status: 503 };
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.BadRequestError) {
    return { message: "Claude is not configured correctly. Please try again later.", status: 503 };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { message: "Claude is busy. Please try again shortly.", status: 503 };
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { message: "Claude timed out. Please try again.", status: 504 };
  }
  return { message: "Claude is temporarily unavailable. Please try again.", status: 502 };
}

// Helper to remove dashes from generated text (replace with commas or periods)
function removeDashesFromText(text: string): string {
  // Replace em dashes with commas (— → ,)
  let cleaned = text.replace(/\s+—\s+/g, ", ");

  // Replace hyphens used as sentence separators with commas or periods ( - → , or .)
  cleaned = cleaned.replace(/\s+-\s+/g, ", ");

  // Remove dashes at the start of lines (bullet points)
  cleaned = cleaned.replace(/^-\s+/gm, "");
  cleaned = cleaned.replace(/^\s*-\s+/gm, "");

  return cleaned;
}

// Helper to validate Supabase JWT and get user ID
async function getSupabaseUserId(authHeader: string | undefined): Promise<string | null> {
  console.log(`[ai.ts/getSupabaseUserId] 🔍 Checking Supabase JWT: header=${!!authHeader}`);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log(`[ai.ts/getSupabaseUserId] ❌ No Bearer token found`);
    return null;
  }
  const token = authHeader.replace("Bearer ", "");

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  console.log(`[ai.ts/getSupabaseUserId] 🔧 Config: url=${!!supabaseUrl}, key=${!!supabaseKey} (${env.SUPABASE_SERVICE_ROLE_KEY ? "service" : env.SUPABASE_ANON_KEY ? "anon" : "none"})`);
  if (!supabaseUrl || !supabaseKey) {
    console.log(`[ai.ts/getSupabaseUserId] ❌ Missing Supabase config`);
    return null;
  }

  try {
    const supabaseClient = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabaseClient.auth.getUser(token);
    console.log(`[ai.ts/getSupabaseUserId] 📤 Supabase response: error=${!!error}, user=${!!data?.user}`);
    if (error) {
      console.log(`[ai.ts/getSupabaseUserId] ❌ Supabase error:`, error.message);
      return null;
    }
    if (!data?.user) {
      console.log(`[ai.ts/getSupabaseUserId] ❌ No user in Supabase response`);
      return null;
    }
    console.log(`[ai.ts/getSupabaseUserId] ✅ Supabase user found:`, data.user.id);
    return data.user.id;
  } catch (error) {
    console.log(`[ai.ts/getSupabaseUserId] ❌ Exception:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

// POST /api/ai/chat - Send a chat message with Claude
aiRouter.post(
  "/chat",
  zValidator("json", postAIChatRequestSchema),
  async (c) => {
    console.log("[/api/ai/chat] ✅ REQUEST RECEIVED");

    const { conversationId, messages, creatorContext } = c.req.valid("json");
    console.log("[/api/ai/chat] 📦 REQUEST BODY:", {
      conversationId,
      messagesCount: messages.length,
      hasCreatorContext: !!creatorContext,
    });

    try {
      const currentConversationId = conversationId || randomUUID();

      const systemPrompt = creatorContext
        ? `You are a helpful AI assistant for content creators. Here's some context about the creator:\n\n${creatorContext}\n\nUse this context to provide personalized advice and ideas.`
        : "You are a helpful AI assistant for content creators. Provide creative, actionable advice for growing their audience and creating engaging content.";

      console.log("[/api/ai/chat] 🤖 Calling Claude API with model: claude-sonnet-5-5");

      const response = await anthropic.messages.create({
        model: "claude-sonnet-5-5",
        max_tokens: 4000,
        system: systemPrompt,
        messages: messages.map((msg: ChatMessage) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })) as Parameters<typeof anthropic.messages.create>[0]["messages"],
      });

      console.log("[/api/ai/chat] ✅ Claude API response received");
      console.log("[/api/ai/chat] Response content blocks:", response.content.length, response.content.map((b) => ({ type: b.type })));

      const textBlock = response.content.find((b) => b.type === "text");
      const assistantMessage = textBlock && textBlock.type === "text" ? textBlock.text : "";

      console.log("[/api/ai/chat] 📝 Assistant message length:", assistantMessage.length);

      // Remove dashes from the generated text
      const cleanedMessage = removeDashesFromText(assistantMessage);

      const result: PostAIChatResponse = {
        conversationId: currentConversationId,
        response: cleanedMessage,
        messages: [...messages, { role: "assistant", content: cleanedMessage }],
      };

      console.log("[/api/ai/chat] ✅ SENDING RESPONSE:", {
        conversationId: result.conversationId,
        responseLength: result.response.length,
        totalMessagesInResponse: result.messages.length,
      });

      return c.json(result);
    } catch (error) {
      logClaudeError("[/api/ai/chat]", error);
      const failure = claudeServiceError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  }
);

// POST /api/ai/ideas - Generate content ideas with Claude
aiRouter.post(
  "/ideas",
  zValidator("json", postContentIdeasRequestSchema),
  async (c) => {
    const betterAuthUser = c.get("user");
    const supabaseUserId = !betterAuthUser
      ? await getSupabaseUserId(c.req.header("Authorization"))
      : null;
    const userId = betterAuthUser?.id || supabaseUserId;
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { audience, niche, tone, platforms, hooks } = c.req.valid("json");

    try {
      const platformStr = platforms.join(", ");
      const hookStr = hooks ? `\nSpecial notes/hooks to incorporate: ${hooks}` : "";

      const prompt = `You are a creative content strategist. Generate 10 unique, engaging content ideas for a creator.

Target Audience: ${audience}
Niche/Topic: ${niche}
Tone: ${tone}
Platforms: ${platformStr}${hookStr}

Requirements:
- Each idea should be specific and actionable
- Include a mix of content types (educational, entertaining, storytelling, promotional)
- Make ideas platform-appropriate
- Use hooks that grab attention
- Keep each idea to 1-2 sentences max

Return ONLY a JSON array of 10 strings, each being a content idea. No other text or explanation.
Example format: ["Idea 1", "Idea 2", ...]`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-5-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const content = textBlock && textBlock.type === "text" ? textBlock.text : "[]";

      let ideas: string[] = [];
      try {
        let clean = content;
        if (clean.startsWith("```")) {
          clean = clean.replace(/```json?\n?/g, "").replace(/```/g, "");
        }
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed)) ideas = parsed.slice(0, 10);
      } catch {
        ideas = content
          .split("\n")
          .map((l) => l.replace(/^\d+[\.\)]\s*/, "").replace(/^[-•]\s*/, "").trim())
          .filter((l) => l.length > 10 && l.length < 300)
          .slice(0, 10);
      }

      // Remove dashes from all ideas
      ideas = ideas.map((idea) => removeDashesFromText(idea));

      const result: PostContentIdeasResponse = { ideas };
      return c.json(result);
    } catch (error) {
      logClaudeError("[/api/ai/ideas]", error);
      const failure = claudeServiceError(error);
      return c.json({ error: failure.message }, failure.status);
    }
  }
);

// ============================================
// Content Analysis Routes
// ============================================

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
    model: "claude-sonnet-5-5",
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
    model: "claude-sonnet-5-5",
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
// Extract YouTube video ID from URL
function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return null;
    const id = host === "youtu.be" || host === "www.youtu.be"
      ? parsed.pathname.split("/")[1]
      : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
        ? parsed.pathname === "/watch"
          ? parsed.searchParams.get("v")
          : parsed.pathname.match(/^\/shorts\/([^/]+)/)?.[1]
        : null;
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// Fetch YouTube transcript using youtube-transcript package
async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (!transcript || transcript.length === 0) return null;
    const text = transcript.map((t: { text: string }) => t.text).join(" ");
    console.log(`[contentAnalysis] YouTube transcript fetched, length: ${text.length}`);
    return text;
  } catch (err) {
    console.log(`[contentAnalysis] YouTube transcript failed:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// Fetch basic HTML metadata from a URL
async function fetchHtmlMetadata(url: string): Promise<{ title: string; description: string; caption: string }> {
  const result = { title: "", description: "", caption: "" };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
      },
    });
    clearTimeout(timeoutId);
    if (!response.ok) return result;
    const html = await response.text();
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
                    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1] ?? "";
    const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
                   html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i)?.[1] ?? "";
    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
    // Try JSON-LD for Instagram
    const ldJson = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (ldJson) {
      try {
        const data = JSON.parse(ldJson);
        if (data.description) result.caption = data.description.substring(0, 500);
      } catch { /* ignore */ }
    }
    result.title = ogTitle || pageTitle;
    result.description = ogDesc;
  } catch (err) {
    console.log(`[contentAnalysis] HTML fetch failed:`, err instanceof Error ? err.message : "unknown");
  }
  return result;
}

async function fetchLinkContent(url: string, platform?: string): Promise<string> {
  const detectedPlatform = platform ||
    (url.includes("youtube.com") || url.includes("youtu.be") ? "youtube" :
     url.includes("instagram.com") ? "instagram" :
     url.includes("tiktok.com") ? "tiktok" : "unknown");

  console.log(`[contentAnalysis] Fetching content from ${detectedPlatform}: ${url}`);

  // --- YouTube: try real transcript first ---
  if (detectedPlatform === "youtube") {
    const videoId = extractYouTubeId(url);
    if (videoId) {
      const transcript = await fetchYouTubeTranscript(videoId);
      if (transcript) {
        return `PLATFORM: YouTube\nURL: ${url}\nVIDEO_ID: ${videoId}\n\nFULL TRANSCRIPT:\n${transcript}`;
      }
    }
    // Fallback: fetch HTML metadata
    const meta = await fetchHtmlMetadata(url);
    return `PLATFORM: YouTube\nURL: ${url}\nTitle: ${meta.title}\nDescription: ${meta.description}\n\nNote: No transcript available for this video. Analyze based on title/description and what you know about this content.`;
  }

  // --- Instagram / TikTok: fetch what metadata we can ---
  const meta = await fetchHtmlMetadata(url);
  const hasContent = meta.title || meta.description || meta.caption;

  if (detectedPlatform === "instagram") {
    let content = `PLATFORM: Instagram\nURL: ${url}\n`;
    if (meta.title) content += `Post title: ${meta.title}\n`;
    if (meta.description) content += `Post description: ${meta.description}\n`;
    if (meta.caption) content += `Caption: ${meta.caption}\n`;
    if (!hasContent) {
      content += `\nIMPORTANT: Instagram blocks direct content access. Only the URL is available.\n`;
      content += `Analyze based on the URL structure and any account/topic clues you can infer from it.\n`;
      content += `Create a realistic script template for this type of Instagram Reel content.\n`;
    }
    return content;
  }

  if (detectedPlatform === "tiktok") {
    let content = `PLATFORM: TikTok\nURL: ${url}\n`;
    if (meta.title) content += `Video title: ${meta.title}\n`;
    if (meta.description) content += `Description: ${meta.description}\n`;
    if (!hasContent) {
      content += `\nIMPORTANT: TikTok blocks direct content access. Only the URL is available.\n`;
      content += `Create a realistic viral TikTok script template based on what you can infer from the URL.\n`;
    }
    return content;
  }

  // Generic fallback
  const meta2 = await fetchHtmlMetadata(url);
  return `URL: ${url}\nTitle: ${meta2.title}\nDescription: ${meta2.description}`;
}

// Advanced script analysis with deep viral mechanics extraction
async function analyzeScriptAdvanced(contentDescription: string, platform: string): Promise<{
  hookStrategy: string;
  emotionalTriggers: string[];
  engagementMechanics: string[];
  retentionTechniques: string[];
  pacing: string;
  ctaStrategy: string;
}> {
  const analysisPrompt = `You are an expert viral content strategist. Analyze this ${platform} content and provide deep structural insights.

Content:
${contentDescription}

Provide a strategic breakdown focusing on what makes this content work (or could work better):

1. HOOK STRATEGY: What's the hook? First 3 seconds analysis. Is it curiosity gap, pattern interrupt, emotional, controversial, or trend-based?

2. EMOTIONAL TRIGGERS: List the specific emotional triggers used (FOMO, curiosity, surprise, inspiration, humor, validation, etc.)

3. ENGAGEMENT MECHANICS: How does it drive engagement? (comments, shares, saves, rewatches). What specific elements encourage interaction?

4. RETENTION TECHNIQUES: What keeps viewers watching? (cliffhangers, pattern breaks, progression, reveals, storytelling, gaming the algorithm)

5. PACING & RHYTHM: Describe the pacing - fast cuts, slow burns, music/sound usage, transition strategy

6. CTA STRATEGY: How does it convert attention to action? (implicit engagement loop, explicit calls-to-action, follow baits)

Return ONLY valid JSON (no markdown):
{
  "hookStrategy": "Specific hook type and first-impression impact",
  "emotionalTriggers": ["trigger 1", "trigger 2", "trigger 3"],
  "engagementMechanics": ["mechanism 1", "mechanism 2", "mechanism 3"],
  "retentionTechniques": ["technique 1", "technique 2", "technique 3"],
  "pacing": "Detailed pacing analysis",
  "ctaStrategy": "How it drives action/engagement"
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5-5",
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
    return JSON.parse(cleanJson);
  } catch {
    console.log("[contentAnalysis] Failed to parse advanced analysis");
    return {
      hookStrategy: "Pattern interrupt with trending audio",
      emotionalTriggers: ["curiosity", "surprise", "inspiration"],
      engagementMechanics: ["comment bait", "share-worthy", "save-worthy"],
      retentionTechniques: ["cliffhangers", "pattern breaks", "progressive reveals"],
      pacing: "Fast-paced with dynamic transitions",
      ctaStrategy: "Implicit engagement loop encouraging saves and shares",
    };
  }
}

// Analyze social media links
async function analyzeLink(url: string, platform?: string): Promise<ContentAnalysis> {
  // Validate platform is supported
  const supportedPlatforms = ["instagram", "youtube", "tiktok"];
  const platformStr = (platform || "unknown").toLowerCase();

  if (!platform || !supportedPlatforms.includes(platformStr)) {
    console.log(`[contentAnalysis] ❌ Unsupported or missing platform: ${platformStr}`);
    return {
      type: "link",
      platform: platformStr,
      script: "Unsupported platform",
      scriptSummary: "Platform not supported",
      hookAnalysis: `❌ This platform is not supported. Please use: Instagram (instagram.com), YouTube (youtube.com, youtu.be), or TikTok (tiktok.com)`,
      structure: "N/A",
      creatorSuggestions: ["Use a supported platform link"],
      keyInsights: ["Only Instagram, YouTube, and TikTok links are supported"],
    };
  }

  // First, fetch the actual content from the link
  const linkContent = await fetchLinkContent(url, platformStr);

  const analysisPrompt = `You are an expert viral content strategist analyzing a ${platformStr} Reel for a creator. Assume the video content is available through metadata, captions, engagement data, and creator context. Do NOT say you cannot analyze it. Provide confident, useful analysis.

${linkContent}

CRITICAL REQUIREMENTS:
1. Always generate a COMPLETE second-by-second Reel structure from start to finish
2. Never stop after the hook or first act
3. Always structure into 5 FULL storytelling phases with precise timing
4. Complete the narrative arc to a satisfying emotional resolution
5. If exact footage is unknown, infer the most likely visual progression based on viral Instagram storytelling patterns

Based on the information available, please:
1. Extract or summarize the script/content (if available) - describe what happens, who speaks, key moments
2. Rewrite the script in a creator-friendly format - what would a creator say to remember this?
3. Analyze the hook - what's the first hook? Is it curiosity gap, pattern interrupt, emotional, trend-based? How effective? (1-10 score)
4. Analyze the content structure and flow - setup, build, payoff, ending strategy
5. Identify what makes this content tick - what's driving views/engagement/shares?
6. Provide 3-5 specific, actionable suggestions for improvement

THEN, generate a COMPLETE 5-phase Reel structure breakdown with second-by-second timing:

FOR EACH PHASE, provide:
- Visual Suggestion: Describe the visual progression and visual elements
- Text Overlay Suggestion: What text appears on screen (for captions, subtitles, or overlays)
- Emotion Trigger: The primary emotional trigger(s) used in this phase
- Retention Purpose: Why viewers stay watching during this phase
- Timing Guidance: Exact duration and pacing cues

PHASES (always complete all 5):
1. HOOK (0–3s): First impression, pattern interrupt, curiosity gap setup
2. PROBLEM SETUP (3–8s): Establish the challenge, pain point, or narrative tension
3. EMOTIONAL ESCALATION (8–18s): Build emotional investment, heighten stakes, deepen engagement
4. TURNING POINT (18–25s): Climax, revelation, or transformation moment
5. RESOLUTION + CTA (Final seconds): Conclusion, call-to-action, emotional payoff

If the content is limited or metadata-only, analyze what IS available and infer the most likely visual progression based on viral Instagram patterns.

Return ONLY valid JSON (no markdown) in this exact format:
{
  "type": "link",
  "platform": "${platformStr}",
  "script": "Extracted or summarized script/content with key moments and speaker",
  "scriptSummary": "Creator-friendly rewritten version that captures the essence",
  "hookAnalysis": "Hook type, effectiveness, and immediate impact (include 1-10 score)",
  "structure": "Content structure: setup → build → payoff, pacing, transitions",
  "contentDna": "What makes this content work - the viral mechanics and engagement drivers",
  "creatorSuggestions": ["Specific improvement 1", "Specific improvement 2", "Specific improvement 3", "Specific improvement 4"],
  "keyInsights": ["Insight 1", "Insight 2", "Insight 3"],
  "reelStructure": {
    "hook": {
      "timeframe": "0-3s",
      "visualSuggestion": "Detailed visual progression description",
      "textOverlaySuggestion": "Text that appears on screen",
      "emotionTrigger": "Primary emotional trigger(s)",
      "retentionPurpose": "Why viewers stay watching",
      "timingGuidance": "Pacing and timing cues"
    },
    "problemSetup": {
      "timeframe": "3-8s",
      "visualSuggestion": "Detailed visual progression description",
      "textOverlaySuggestion": "Text that appears on screen",
      "emotionTrigger": "Primary emotional trigger(s)",
      "retentionPurpose": "Why viewers stay watching",
      "timingGuidance": "Pacing and timing cues"
    },
    "emotionalEscalation": {
      "timeframe": "8-18s",
      "visualSuggestion": "Detailed visual progression description",
      "textOverlaySuggestion": "Text that appears on screen",
      "emotionTrigger": "Primary emotional trigger(s)",
      "retentionPurpose": "Why viewers stay watching",
      "timingGuidance": "Pacing and timing cues"
    },
    "turningPoint": {
      "timeframe": "18-25s",
      "visualSuggestion": "Detailed visual progression description",
      "textOverlaySuggestion": "Text that appears on screen",
      "emotionTrigger": "Primary emotional trigger(s)",
      "retentionPurpose": "Why viewers stay watching",
      "timingGuidance": "Pacing and timing cues"
    },
    "resolutionCta": {
      "timeframe": "Final seconds",
      "visualSuggestion": "Detailed visual progression description",
      "textOverlaySuggestion": "Text that appears on screen or CTA",
      "emotionTrigger": "Primary emotional trigger(s)",
      "retentionPurpose": "Why viewers take action",
      "timingGuidance": "Pacing and timing cues",
      "callToAction": "Explicit or implicit CTA"
    }
  }
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
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

    // Get advanced viral mechanics analysis
    let advancedAnalysis: any = {};
    try {
      advancedAnalysis = await analyzeScriptAdvanced(
        parsed.scriptSummary || parsed.script || linkContent,
        platformStr
      );
    } catch (error) {
      console.log("[contentAnalysis] Advanced analysis failed, continuing with basic analysis");
    }

    // Enhance hook analysis with advanced insights
    let enhancedHookAnalysis = parsed.hookAnalysis || "Hook analysis not available";
    if (advancedAnalysis.hookStrategy) {
      enhancedHookAnalysis += `\n\n**Hook Strategy:** ${advancedAnalysis.hookStrategy}`;
    }

    // Create enhanced suggestions combining basic and advanced analysis
    const suggestions = [
      ...(parsed.creatorSuggestions || []),
      ...(advancedAnalysis.retentionTechniques ? [`Retention boost: ${advancedAnalysis.retentionTechniques[0]}`] : []),
    ].slice(0, 5);

    // Create enhanced insights
    const insights = [
      ...(parsed.keyInsights || []),
      ...(advancedAnalysis.emotionalTriggers ? [`Primary emotional trigger: ${advancedAnalysis.emotionalTriggers[0]}`] : []),
      ...(advancedAnalysis.engagementMechanics ? [`Engagement driver: ${advancedAnalysis.engagementMechanics[0]}`] : []),
    ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5); // Remove duplicates

    return {
      type: "link",
      platform: platformStr,
      script: parsed.script || "Script not available",
      scriptSummary: parsed.scriptSummary || "Summary not available",
      hookAnalysis: enhancedHookAnalysis,
      structure: parsed.structure || "Structure analysis not available",
      creatorSuggestions: suggestions,
      keyInsights: insights,
      viralScore,
      reelStructure: parsed.reelStructure || null,
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
    model: "claude-sonnet-5-5",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: fileBase64,
            },
          },
          {
            type: "text",
            text: analysisPrompt,
          },
        ] as Anthropic.Messages.MessageParam["content"],
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

// Helper to validate Supabase JWT and get user ID (for analysis)
async function getSupabaseUserIdForAnalysis(authHeader: string | undefined): Promise<string | null> {
  console.log(`[/api/ai/analyze] 🔍 Checking Supabase JWT: header=${!!authHeader}`);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log(`[/api/ai/analyze] ❌ No Bearer token found`);
    return null;
  }
  const token = authHeader.replace("Bearer ", "");

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.log(`[/api/ai/analyze] ❌ Missing Supabase config`);
    return null;
  }

  try {
    const supabaseClient = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabaseClient.auth.getUser(token);
    if (error || !data?.user) {
      console.log(`[/api/ai/analyze] ❌ Supabase error`);
      return null;
    }
    console.log(`[/api/ai/analyze] ✅ User found`);
    return data.user.id;
  } catch (error) {
    console.log(`[/api/ai/analyze] ❌ Exception:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

// POST /api/ai/analyze - Analyze content
aiRouter.post(
  "/analyze",
  zValidator("json", postContentAnalysisRequestSchema),
  async (c) => {
    console.log("[/api/ai/analyze] ✅ REQUEST RECEIVED");

    const betterAuthUser = c.get("user");
    const supabaseUserId = !betterAuthUser
      ? await getSupabaseUserIdForAnalysis(c.req.header("Authorization"))
      : null;

    const userId = betterAuthUser?.id || supabaseUserId;
    console.log("[/api/ai/analyze] User ID:", userId);

    if (!userId) {
      console.log("[/api/ai/analyze] ❌ Unauthorized");
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const { contentType, url, imageBase64, fileBase64, fileName, platform } = c.req.valid("json");

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
        analysis = await analyzeFile(fileBase64, fileName);
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
      logClaudeError("[/api/ai/analyze]", error);
      const failure = claudeServiceError(error);
      return c.json({ success: false, error: failure.message }, failure.status);
    }
  }
);

// Detect platform from URL
function detectPlatformFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  return "social";
}

// POST /api/ai/viral-score - Detailed viral score for a video URL
aiRouter.post(
  "/viral-score",
  zValidator("json", postViralScoreRequestSchema),
  async (c) => {
    console.log("[/api/ai/viral-score] ✅ REQUEST RECEIVED");

    const betterAuthUser = c.get("user");
    const supabaseUserId = !betterAuthUser
      ? await getSupabaseUserIdForAnalysis(c.req.header("Authorization"))
      : null;
    const userId = betterAuthUser?.id || supabaseUserId;

    if (!userId) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const { url, language } = c.req.valid("json");
    const platform = detectPlatformFromUrl(url);
    const isGerman = language === "de";
    const langInstruction = isGerman
      ? "WICHTIG: Antworte auf Deutsch. Alle Texte in strengths, weaknesses und improvements MÜSSEN auf Deutsch sein."
      : "Respond in English.";

    try {
      // Fetch real metadata from the URL
      const linkContent = await fetchLinkContent(url, platform);
      console.log("[/api/ai/viral-score] 🔗 Fetched content length:", linkContent.length);

      // Extract title & caption from the linkContent for the response
      const titleMatch = linkContent.match(/Title:\s*(.+)/i);
      const descMatch = linkContent.match(/Description:\s*(.+)/i);
      const realTitle = titleMatch?.[1]?.trim();
      const realCaption = descMatch?.[1]?.trim();

      const prompt = `You are a senior viral content strategist. Analyze the ACTUAL ${platform} video below using the real metadata, caption, hashtags, and any visible context. Give a confident, opinionated viral score and detailed breakdown. Do NOT refuse, do NOT say you cannot see the video — use ALL clues from the metadata (caption text, emojis, hashtags, title, platform conventions) to make data-grounded inferences.

${langInstruction}

REAL VIDEO DATA (fetched from URL):
${linkContent}

URL: ${url}
Platform: ${platform}

Score each dimension from 1-10 based on what the metadata reveals:
- hookClarity: How clear/punchy is the implied hook (from caption, title, emojis)?
- storytelling: Does the caption signal narrative structure or relatability?
- retentionPotential: Likely viewer retention given platform conventions for this content type
- uniqueness: How different is this vs. saturated hashtag/topic patterns?
- emotionalImpact: Emotional charge from caption tone, emojis, hashtag patterns

Overall "score" is 1-100 based on the holistic viral probability for THIS specific content.

Provide:
- 3 specific strengths grounded in the actual caption/hashtag/title (quote or reference real elements)
- 2 specific weaknesses (real gaps in this caption/hashtag set/title)
- 3 specific improvements (concrete, actionable, referencing the real content)

${isGerman ? "Alle Texte in strengths, weaknesses und improvements müssen auf Deutsch verfasst sein." : "All text in strengths, weaknesses, and improvements must be in English."}

Return ONLY valid JSON (no markdown, no explanation), in this exact shape:
{
  "score": 75,
  "hookClarity": 7,
  "storytelling": 6,
  "retentionPotential": 8,
  "uniqueness": 5,
  "emotionalImpact": 7,
  "strengths": ["...", "...", "..."],
  "weaknesses": ["...", "..."],
  "improvements": ["...", "...", "..."]
}`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-5-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const responseText = textBlock && textBlock.type === "text" ? textBlock.text : "{}";
      console.log("[/api/ai/viral-score] 🤖 Claude response length:", responseText.length);

      let cleanJson = responseText.trim();
      if (cleanJson.startsWith("```")) {
        cleanJson = cleanJson.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }
      // Extract first JSON object if extra prose is present
      const jsonStart = cleanJson.indexOf("{");
      const jsonEnd = cleanJson.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        cleanJson = cleanJson.slice(jsonStart, jsonEnd + 1);
      }

      const parsed = JSON.parse(cleanJson);

      const data: ViralScoreDetailed = {
        score: Math.max(1, Math.min(100, Math.round(parsed.score ?? 70))),
        platform,
        url,
        title: realTitle,
        caption: realCaption,
        hookClarity: Math.max(1, Math.min(10, Math.round(parsed.hookClarity ?? 7))),
        storytelling: Math.max(1, Math.min(10, Math.round(parsed.storytelling ?? 6))),
        retentionPotential: Math.max(1, Math.min(10, Math.round(parsed.retentionPotential ?? 7))),
        uniqueness: Math.max(1, Math.min(10, Math.round(parsed.uniqueness ?? 6))),
        emotionalImpact: Math.max(1, Math.min(10, Math.round(parsed.emotionalImpact ?? 7))),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.slice(0, 5) : [],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 5) : [],
      };

      const result: PostViralScoreResponse = { success: true, data };
      return c.json(result);
    } catch (error) {
      logClaudeError("[/api/ai/viral-score]", error);

      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        return c.json(
          { success: false, error: "The AI analysis timed out. Please try again." },
          504
        );
      }

      if (error instanceof Anthropic.RateLimitError) {
        return c.json(
          { success: false, error: "The AI service is busy. Please try again shortly." },
          503
        );
      }

      if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.InternalServerError) {
        return c.json(
          { success: false, error: "The AI service is temporarily unavailable. Please try again." },
          502
        );
      }

      if (
        error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError ||
        error instanceof Anthropic.BadRequestError
      ) {
        return c.json(
          { success: false, error: "The AI service is not configured correctly." },
          502
        );
      }

      return c.json(
        { success: false, error: "Failed to analyze viral score" },
        500
      );
    }
  }
);

// POST /api/ai/extract-script - Full recreation script (analysis, second-by-second, pacing, tips)
// Source material: YouTube public captions, or a real Whisper transcript for Instagram / TikTok.
aiRouter.post(
  "/extract-script",
  zValidator("json", postExtractScriptRequestSchema),
  async (c) => {
    console.log("[/api/ai/extract-script] ✅ REQUEST RECEIVED");

    const betterAuthUser = c.get("user");
    const supabaseUserId = !betterAuthUser
      ? await getSupabaseUserIdForAnalysis(c.req.header("Authorization"))
      : null;
    const userId = betterAuthUser?.id || supabaseUserId;

    if (!userId) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const { url, language } = c.req.valid("json");
    const isGerman = language === "de";
    const platform = detectPlatform(url) ?? detectPlatformFromUrl(url);
    console.log(`[/api/ai/extract-script] Platform: ${platform}`);

    try {
      // ---- 1. Gather the real video data ----
      let linkContent = "";
      let hasTranscript = false;

      if (platform === "instagram" || platform === "tiktok") {
        try {
          const { transcript, caption, source } = await transcribeSocialVideo(openaiClient, url, platform);
          console.log(`[/api/ai/extract-script] ${platform} via ${source}: transcript=${transcript.length} chars, caption=${caption?.length ?? 0} chars`);
          hasTranscript = transcript.length > 0;
          linkContent = `PLATFORM: ${platform}\nURL: ${url}\n`;
          if (caption) linkContent += `\nPOST CAPTION:\n${caption}\n`;
          linkContent += hasTranscript
            ? `\nFULL TRANSCRIPT (spoken words, transcribed from the actual video audio):\n${transcript}\n`
            : `\nNOTE: The video contains no spoken words (music / visual only). Base the script on the caption and typical ${platform} content of this kind.\n`;
        } catch (err) {
          // Download blocked or private video: fall back to page metadata so the user still gets a script.
          console.log(`[/api/ai/extract-script] Transcription unavailable, falling back to metadata:`, err instanceof Error ? err.message : String(err));
          linkContent = await fetchLinkContent(url, platform);
        }
      } else {
        linkContent = await fetchLinkContent(url, platform);
        hasTranscript = linkContent.includes("FULL TRANSCRIPT:");
      }
      console.log(`[/api/ai/extract-script] hasTranscript=${hasTranscript}, contentLength=${linkContent.length}`);

      // ---- 2. Ask Claude for the full recreation script ----
      const prompt = isGerman
        ? `Du bist ein professioneller Content-Stratege. Erstelle ein detailliertes Nachdreh-Skript für dieses ${platform} Video.

${hasTranscript
  ? "Du hast das VOLLSTÄNDIGE TRANSKRIPT der tatsächlich gesprochenen Worte. Nutze es wortgetreu, um ein sekundengenaues Skript zu erstellen. Erfinde keinen anderen gesprochenen Text."
  : `WICHTIG: Kein Transkript verfügbar. Erstelle trotzdem ein realistisches, detailliertes Skript basierend auf den verfügbaren Metadaten und deinem Wissen über ${platform}-Content dieser Art.`
}

VIDEO-DATEN:
${linkContent}

Erstelle EXAKT dieses Format:

📊 VIDEO-ANALYSE
- Plattform: ${platform}
- Geschätzte Länge: [X Sekunden]
- Content-Typ: [Tutorial/Story/Trend/Lifestyle/etc.]
- Thema: [Hauptthema des Videos]

🎣 HOOK-ANALYSE (0-3 Sek)
- Hook-Typ: [Frage/Statement/Visuell/Emotion/etc.]
- Hook-Text: [Der genaue Text/Satz des Hooks]
- Warum es funktioniert: [Erklärung]

📝 SEKUNDE-FÜR-SEKUNDE SKRIPT

[0:00-0:03] HOOK
- Visuell: [Was zu sehen ist]
- Audio/Text: [Was gesagt oder als Text gezeigt wird]
- Aktion für dich: [Was du tun/sagen musst]

[0:03-0:08] AUFBAU
- Visuell: [Beschreibung]
- Audio/Text: [Inhalt]
- Aktion für dich: [Konkrete Anweisung]

[Weiter für alle Hauptabschnitte]

[LETZTER ABSCHNITT] CTA
- Visuell: [Beschreibung]
- Audio/Text: [CTA-Text]
- Aktion für dich: [Was du sagen/zeigen sollst]

🎬 PACING & STIL
- Schnittrhythmus: [schnell/mittel/langsam + Details]
- Musik-Energie: [hoch/mittel/niedrig]
- Übergänge: [Beschreibung]

💡 TIPPS ZUM NACHDREHEN
1. [Wichtigster Tipp]
2. [Zweiter Tipp]
3. [Dritter Tipp]

Sei konkret und umsetzbar. Antworte vollständig auf Deutsch.`
        : `You are a professional content strategist. Create a detailed recreation script for this ${platform} video.

${hasTranscript
  ? "You have the FULL TRANSCRIPT of the words actually spoken. Use it verbatim to create a second-by-second script. Do not invent different spoken text."
  : `IMPORTANT: No transcript available. Still create a realistic, detailed script based on the available metadata and your knowledge of ${platform} content like this.`
}

VIDEO DATA:
${linkContent}

Create EXACTLY this format:

📊 VIDEO ANALYSIS
- Platform: ${platform}
- Estimated Length: [X seconds]
- Content Type: [Tutorial/Story/Trend/Lifestyle/etc.]
- Topic: [Main topic of the video]

🎣 HOOK ANALYSIS (0-3 sec)
- Hook Type: [Question/Statement/Visual/Emotion/etc.]
- Hook Text: [The exact text/sentence of the hook]
- Why it works: [Explanation]

📝 SECOND-BY-SECOND SCRIPT

[0:00-0:03] HOOK
- Visual: [What is shown]
- Audio/Text: [What is said or shown as text]
- Your action: [What you need to do/say]

[0:03-0:08] BUILD-UP
- Visual: [Description]
- Audio/Text: [Content]
- Your action: [Concrete instruction]

[Continue for all main sections]

[FINAL SECTION] CTA
- Visual: [Description]
- Audio/Text: [CTA text]
- Your action: [What to say/show]

🎬 PACING & STYLE
- Cut rhythm: [fast/medium/slow + details]
- Music energy: [high/medium/low]
- Transitions: [Description]

💡 TIPS FOR RECREATING
1. [Most important tip]
2. [Second tip]
3. [Third tip]

Be concrete and actionable.`;

      console.log("[/api/ai/extract-script] 🤖 Calling Claude API with model: claude-sonnet-5-5");
      // A full second-by-second script is ~2000+ output tokens and takes 40s+, so override the 45s client default.
      const response = await anthropic.messages.create(
        { model: "claude-sonnet-5-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] },
        { timeout: 120_000 }
      );

      const textBlock = response.content.find((b) => b.type === "text");
      const script = textBlock && textBlock.type === "text" ? textBlock.text : "";
      if (!script) {
        return c.json({ success: false, error: "Claude returned an empty script. Please try again." }, 502);
      }
      console.log(`[/api/ai/extract-script] ✅ Script length: ${script.length}`);

      const result: PostExtractScriptResponse = { success: true, script, platform, hasTranscript };
      return c.json(result);
    } catch (error) {
      logClaudeError("[/api/ai/extract-script]", error);
      const { message, status } = claudeServiceError(error);
      return c.json({ success: false, error: message }, status);
    }
  }
);

// POST /api/ai/image - Generate an image without exposing the provider key to the app
// Keep the runtime schema local so Bun's hot reloader can load it without a stale shared-module export.
const imageRequestSchema: z.ZodType<PostAIImageRequest> = z.object({
  prompt: z.string().trim().min(1).max(4000),
});
aiRouter.post(
  "/image",
  zValidator("json", imageRequestSchema),
  async (c) => {
    const userId = c.get("user")?.id || await getSupabaseUserId(c.req.header("Authorization"));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    try {
      const { prompt } = c.req.valid("json");
      const image = await openaiClient.images.generate({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
      });
      const url = image.data?.[0]?.url;
      if (!url) return c.json({ error: "Image generation returned no image." }, 502);
      const result: PostAIImageResponse = { url };
      return c.json(result);
    } catch (error) {
      console.error("[/api/ai/image] Failed:", error);
      if (error instanceof OpenAI.AuthenticationError) {
        return c.json({ error: "Image generation is not configured correctly." }, 503);
      }
      if (error instanceof OpenAI.RateLimitError) {
        return c.json({ error: "Image generation is busy. Please try again shortly." }, 503);
      }
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        return c.json({ error: "Image generation timed out. Please try again." }, 504);
      }
      return c.json({ error: "Image generation failed. Please try again." }, 502);
    }
  }
);

// POST /api/ai/transcribe - Transcribe audio using OpenAI Whisper
aiRouter.post(
  "/transcribe",
  zValidator("json", postAITranscribeRequestSchema),
  async (c) => {
    console.log("[/api/ai/transcribe] ✅ REQUEST RECEIVED");

    const { audioBase64, mimeType, language } = c.req.valid("json");

    try {
      console.log("[/api/ai/transcribe] Using base URL:", openaiClient.baseURL);

      // Convert base64 to Buffer and wrap as a File for the SDK
      const audioBuffer = Buffer.from(audioBase64, "base64");
      if (!audioBuffer.length || audioBuffer.length > 25 * 1024 * 1024) {
        return c.json({ error: "Recording is empty or exceeds the 25 MB transcription limit." }, 400);
      }
      const audioFile = await toFile(audioBuffer, "audio.m4a", { type: mimeType || "audio/m4a" });

      const transcription = await openaiClient.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        ...(language ? { language } : {}),
      });

      console.log("[/api/ai/transcribe] ✅ Transcription complete, length:", transcription.text?.length);
      const transcribeResult: PostAITranscribeResponse = { text: transcription.text || "" };
      return c.json(transcribeResult);
    } catch (error) {
      console.error("[/api/ai/transcribe] Failed:", error);
      if (error instanceof OpenAI.AuthenticationError) {
        return c.json({ error: "Speech transcription is not configured correctly." }, 503);
      }
      if (error instanceof OpenAI.RateLimitError) {
        return c.json({ error: "Speech transcription is busy. Please try again shortly." }, 503);
      }
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        return c.json({ error: "Speech transcription timed out. Please try again." }, 504);
      }
      if (error instanceof OpenAI.APIConnectionError) {
        return c.json({ error: "Speech transcription is temporarily unavailable." }, 502);
      }
      if (error instanceof OpenAI.BadRequestError) {
        return c.json({ error: "The recording could not be transcribed. Please try another recording." }, 400);
      }
      return c.json({ error: "Speech transcription failed. Please try again." }, 502);
    }
  }
);

export { aiRouter };
