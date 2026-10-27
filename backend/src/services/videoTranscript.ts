/**
 * Video transcript extraction for Instagram Reels and TikTok videos.
 *
 * Flow: resolve a downloadable media URL -> download -> ffmpeg to compact mono mp3
 * -> OpenAI Whisper transcription. Everything runs in a temp dir that is always cleaned up.
 *
 * Resolvers (in order):
 *  - TikTok:    tikwm.com public API (works from datacenter IPs), then yt-dlp as fallback
 *  - Instagram: yt-dlp (bundled at backend/bin/yt-dlp, needs python3), then og:video meta tag
 */
import { spawn } from "child_process";
import { mkdtemp, readFile, rm, stat } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import OpenAI, { toFile } from "openai";

export type SocialPlatform = "youtube" | "instagram" | "tiktok";

export interface VideoTranscriptResult {
  transcript: string;
  /** Caption / description text from the post, when the resolver exposed it. */
  caption?: string;
  platform: SocialPlatform;
  source: "tikwm" | "yt-dlp" | "og:video";
}

export class VideoTranscriptError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
    this.name = "VideoTranscriptError";
  }
}

const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;
const STEP_TIMEOUT_MS = 120_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const YT_DLP_PATH =
  process.env.YT_DLP_PATH ||
  [path.join(process.cwd(), "bin", "yt-dlp"), path.join(process.cwd(), "backend", "bin", "yt-dlp")].find((p) =>
    existsSync(p)
  ) ||
  "yt-dlp";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export function detectPlatform(rawUrl: string): SocialPlatform | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  if (["youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"].includes(host)) return "youtube";
  if (host === "instagram.com" || host === "instagr.am" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok"; // covers vm./vt./m. short links
  return null;
}

// ---------------------------------------------------------------------------
// Process / fetch helpers
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[], timeoutMs = STEP_TIMEOUT_MS): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(cmd)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function downloadToFile(url: string, dest: string, referer?: string): Promise<void> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, ...(referer ? { Referer: referer } : {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Media download failed with status ${res.status}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > DOWNLOAD_MAX_BYTES) throw new Error(`Media too large: ${declared} bytes`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("Media download returned an empty body");
  if (buf.length > DOWNLOAD_MAX_BYTES) throw new Error(`Media too large: ${buf.length} bytes`);
  await Bun.write(dest, buf);
}

async function convertToAudio(input: string, output: string): Promise<void> {
  const { code, stderr } = await run("ffmpeg", [
    "-y", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", output,
  ]);
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${stderr.slice(0, 300)}`);
  const size = (await stat(output)).size;
  if (!size) throw new Error("ffmpeg produced an empty audio file");
  if (size > WHISPER_MAX_BYTES) throw new Error(`Audio exceeds Whisper limit: ${size} bytes`);
}

async function transcribeAudioFile(openai: OpenAI, filePath: string, language?: string): Promise<string> {
  const buf = await readFile(filePath);
  const file = await toFile(buf, "audio.mp3", { type: "audio/mpeg" });
  const result = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    ...(language ? { language } : {}),
  });
  return (result.text || "").trim();
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

// ---------------------------------------------------------------------------
// Resolvers: each returns a local media file path plus optional caption
// ---------------------------------------------------------------------------

interface ResolvedMedia {
  filePath: string;
  caption?: string;
  source: VideoTranscriptResult["source"];
  /** True when the file is already audio-only (skip re-encode if small enough). */
  isAudio?: boolean;
}

async function resolveTikTokViaTikwm(url: string, dir: string): Promise<ResolvedMedia> {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=0`, {
    headers: { "User-Agent": BROWSER_UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`tikwm responded ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string; data?: Record<string, unknown> };
  if (json.code !== 0 || !json.data) throw new Error(`tikwm error: ${json.msg || "unknown"}`);

  const pick = (k: string) => {
    const v = json.data?.[k];
    if (typeof v !== "string" || !v) return null;
    return v.startsWith("/") ? `https://www.tikwm.com${v}` : v;
  };
  // Prefer the video (contains speech); "music" can be the background track only.
  const mediaUrl = pick("play") || pick("wmplay") || pick("hdplay");
  if (!mediaUrl) throw new Error("tikwm returned no playable media URL");

  const filePath = path.join(dir, "tiktok.mp4");
  await downloadToFile(mediaUrl, filePath, "https://www.tiktok.com/");
  const caption = typeof json.data.title === "string" ? json.data.title : undefined;
  return { filePath, caption, source: "tikwm" };
}

async function resolveViaYtDlp(url: string, dir: string): Promise<ResolvedMedia> {
  const outTemplate = path.join(dir, "ytdlp.%(ext)s");
  const descFile = path.join(dir, "description.txt");
  const { code, stderr } = await run(YT_DLP_PATH, [
    "--no-warnings", "--no-playlist", "--quiet",
    "--user-agent", BROWSER_UA,
    "-x", "--audio-format", "mp3",
    "--postprocessor-args", "ffmpeg:-ac 1 -ar 16000 -b:a 48k",
    "--print-to-file", "%(description)s", descFile,
    "-o", outTemplate,
    url,
  ]);
  if (code !== 0) throw new Error(`yt-dlp failed (${code}): ${stderr.trim().split("\n").pop()?.slice(0, 300)}`);

  const filePath = path.join(dir, "ytdlp.mp3");
  if (!existsSync(filePath)) throw new Error("yt-dlp finished but produced no audio file");
  let caption: string | undefined;
  try {
    const raw = (await readFile(descFile, "utf8")).trim();
    if (raw && raw !== "NA") caption = raw;
  } catch { /* description is optional */ }
  return { filePath, caption, source: "yt-dlp", isAudio: true };
}

async function resolveViaOgVideo(url: string, dir: string): Promise<ResolvedMedia> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Page fetch responded ${res.status}`);
  const html = await res.text();
  const video =
    html.match(/<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url|:url)?["']/i)?.[1];
  if (!video) throw new Error("No og:video tag found on the page");

  const caption = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const filePath = path.join(dir, "og.mp4");
  await downloadToFile(decodeHtml(video), filePath, url);
  return { filePath, caption: caption ? decodeHtml(caption) : undefined, source: "og:video" };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function transcribeSocialVideo(
  openai: OpenAI,
  url: string,
  platform: Exclude<SocialPlatform, "youtube">,
  language?: string
): Promise<VideoTranscriptResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "video-transcript-"));
  const log = (msg: string) => console.log(`[videoTranscript] ${msg}`);

  try {
    const resolvers: Array<() => Promise<ResolvedMedia>> =
      platform === "tiktok"
        ? [() => resolveTikTokViaTikwm(url, dir), () => resolveViaYtDlp(url, dir), () => resolveViaOgVideo(url, dir)]
        : [() => resolveViaYtDlp(url, dir), () => resolveViaOgVideo(url, dir)];

    let media: ResolvedMedia | null = null;
    const failures: string[] = [];
    for (const resolve of resolvers) {
      try {
        media = await resolve();
        log(`Resolved ${platform} media via ${media.source}`);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(msg);
        log(`Resolver failed: ${msg}`);
      }
    }
    if (!media) {
      throw new VideoTranscriptError(
        `All resolvers failed for ${platform}: ${failures.join(" | ")}`,
        platform === "instagram"
          ? "This Instagram video could not be loaded. Make sure the account is public and the link points to a Reel or video post."
          : "This TikTok video could not be loaded. Make sure the video is public and the link is correct."
      );
    }

    let audioPath = media.filePath;
    if (!media.isAudio || (await stat(audioPath)).size > WHISPER_MAX_BYTES) {
      audioPath = path.join(dir, "audio.mp3");
      await convertToAudio(media.filePath, audioPath);
    }

    log(`Transcribing audio (${(await stat(audioPath)).size} bytes, language=${language || "auto"})`);
    const transcript = await transcribeAudioFile(openai, audioPath, language);
    log(`Transcript length: ${transcript.length}`);

    return { transcript, caption: media.caption, platform, source: media.source };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
