// contracts.ts
// Shared API contracts (schemas and types) used by both the server and the app.
// Import in the app as: `import { type GetSampleResponse } from "@shared/contracts"`
// Import in the server as: `import { postSampleRequestSchema } from "@shared/contracts"`

import { z } from "zod";

// GET /api/sample
export const getSampleResponseSchema = z.object({
  message: z.string(),
});
export type GetSampleResponse = z.infer<typeof getSampleResponseSchema>;

// POST /api/sample
export const postSampleRequestSchema = z.object({
  value: z.string(),
});
export type PostSampleRequest = z.infer<typeof postSampleRequestSchema>;
export const postSampleResponseSchema = z.object({
  message: z.string(),
});
export type PostSampleResponse = z.infer<typeof postSampleResponseSchema>;

// POST /api/upload/image
export const uploadImageRequestSchema = z.object({
  image: z.instanceof(File),
});
export type UploadImageRequest = z.infer<typeof uploadImageRequestSchema>;
export const uploadImageResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  url: z.string(),
  filename: z.string(),
});
export type UploadImageResponse = z.infer<typeof uploadImageResponseSchema>;

// ============================================
// Cloud Sync API Contracts
// ============================================

// Social accounts schema
export const socialAccountsSchema = z.object({
  instagram: z.string().optional(),
  tiktok: z.string().optional(),
  youtube: z.string().optional(),
  pinterest: z.string().optional(),
  linkedin: z.string().optional(),
});
export type SocialAccounts = z.infer<typeof socialAccountsSchema>;

// Dashboard section schema
export const dashboardSectionSchema = z.object({
  id: z.string(),
  visible: z.boolean(),
  order: z.number(),
});
export type DashboardSection = z.infer<typeof dashboardSectionSchema>;

// Visionboard image schema
export const visionboardImageSchema = z.object({
  id: z.string(),
  uri: z.string(),
  addedAt: z.string(),
  showOnDashboard: z.boolean(),
  order: z.number(),
});
export type VisionboardImage = z.infer<typeof visionboardImageSchema>;

// Health data schema
export const healthDataSchema = z.object({
  steps: z.number(),
  water: z.number(),
  sleep: z.number(),
  calories: z.number(),
  workoutMinutes: z.number(),
  lastUpdated: z.string(),
});
export type HealthData = z.infer<typeof healthDataSchema>;

// Analysis results schema
export const analysisResultsSchema = z.object({
  contentPillars: z.array(z.string()),
  engagementPatterns: z.object({
    bestPostingTimes: z.array(z.string()),
    topContentTypes: z.array(z.string()),
    audienceEngagement: z.number(),
  }),
  visualAesthetic: z.object({
    dominantColors: z.array(z.string()),
    style: z.string(),
    consistency: z.number(),
  }),
  topPerformingPosts: z.array(z.object({
    platform: z.string(),
    type: z.string(),
    engagement: z.string(),
  })),
  brandVibeScore: z.number(),
  brandVibeDescription: z.string(),
}).nullable();
export type AnalysisResults = z.infer<typeof analysisResultsSchema>;

// User profile sync schema
export const userProfileSyncSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  displayName: z.string().optional(),
  email: z.string().optional(),
  profilePicture: z.string().nullable().optional(),
  socialAccounts: socialAccountsSchema.optional(),
  creatorNiches: z.array(z.string()).optional(),
  customNiche: z.string().optional(),
  creatorGoals: z.array(z.string()).optional(),
  postingStyle: z.string().nullable().optional(),
  dashboardSections: z.array(dashboardSectionSchema).optional(),
  visionboardImages: z.array(visionboardImageSchema).optional(),
  healthData: healthDataSchema.optional(),
  analysisResults: analysisResultsSchema.optional(),
  hasCompletedOnboarding: z.boolean().optional(),
  hasCompletedAnalysis: z.boolean().optional(),
});
export type UserProfileSync = z.infer<typeof userProfileSyncSchema>;

// GET/PUT /api/sync/profile
export const getUserProfileResponseSchema = userProfileSyncSchema.extend({
  id: z.string().optional(),
});
export type GetUserProfileResponse = z.infer<typeof getUserProfileResponseSchema>;

// Content idea schema
export const contentIdeaSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: z.string(),
  scheduledDate: z.string(),
  status: z.string(),
  hook: z.string().optional(),
  description: z.string().optional(),
  cta: z.string().optional(),
  inspirations: z.array(z.object({
    url: z.string(),
    title: z.string().optional(),
    image: z.string().optional(),
    platform: z.string().optional(),
  })).optional(),
  // ELLY Generation Tracking (NEW)
  isELLYGenerated: z.boolean().optional(),
  generatedBy: z.string().optional(),
  suggestedDate: z.string().optional(),
  generationPrompt: z.string().optional(),
  generationModel: z.string().optional(),
  createdAt: z.string(),
});
export type ContentIdeaSync = z.infer<typeof contentIdeaSchema>;

// Todo schema
export const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  dueDate: z.string().nullable(),
  priority: z.string(),
  completed: z.boolean(),
  createdAt: z.string(),
});
export type TodoSync = z.infer<typeof todoSchema>;

// Calendar event schema
export const calendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  time: z.string(),
  endTime: z.string().optional(),
  notes: z.string().optional(),
  isAllDay: z.boolean().optional(),
  isFromDevice: z.boolean().optional(),
  calendarColor: z.string().optional(),
  syncCategory: z.string().optional(),
  createdAt: z.string(),
  clientId: z.string().optional(),
  isSynced: z.boolean().optional(),
  category: z.string().optional(),
});
export type CalendarEventSync = z.infer<typeof calendarEventSchema>;

// Period entry schema
export const periodEntrySchema = z.object({
  id: z.string(),
  startDate: z.string(),
  endDate: z.string().optional(),
  flow: z.string(),
  symptoms: z.array(z.string()),
  notes: z.string().optional(),
  createdAt: z.string(),
});
export type PeriodEntrySync = z.infer<typeof periodEntrySchema>;

// Period settings schema
export const periodSettingsSchema = z.object({
  cycleLength: z.number(),
  periodLength: z.number(),
  lastPeriodStart: z.string().optional(),
  trackingEnabled: z.boolean(),
  status: z.string(),
  hasChosenTrackerType: z.boolean(),
  dueDate: z.string().optional(),
  pregnancyStartDate: z.string().optional(),
  babyBirthDate: z.string().optional(),
});
export type PeriodSettingsSync = z.infer<typeof periodSettingsSchema>;

// Mood entry schema
export const moodEntrySchema = z.object({
  id: z.string(),
  mood: z.string(),
  note: z.string().optional(),
  date: z.string(),
  createdAt: z.string(),
});
export type MoodEntrySync = z.infer<typeof moodEntrySchema>;

// Habit schema
export const habitSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  frequency: z.string(),
  completedDates: z.array(z.string()),
  createdAt: z.string(),
});
export type HabitSync = z.infer<typeof habitSchema>;

// Goal schema
export const goalSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  targetDate: z.string().optional(),
  progress: z.number(),
  completed: z.boolean(),
  color: z.string(),
  createdAt: z.string(),
});
export type GoalSync = z.infer<typeof goalSchema>;

// Feeding entry schema
export const feedingEntrySchema = z.object({
  id: z.string(),
  date: z.string(),
  time: z.string(),
  side: z.string(),
  duration: z.number(),
  type: z.string(),
  notes: z.string().optional(),
  createdAt: z.string(),
});
export type FeedingEntrySync = z.infer<typeof feedingEntrySchema>;

// Pregnancy symptom schema
export const pregnancySymptomSchema = z.object({
  id: z.string(),
  date: z.string(),
  symptoms: z.array(z.string()),
  notes: z.string().optional(),
  createdAt: z.string(),
});
export type PregnancySymptomSync = z.infer<typeof pregnancySymptomSchema>;

// Kick count schema
export const kickCountSchema = z.object({
  id: z.string(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  count: z.number(),
  createdAt: z.string(),
});
export type KickCountSync = z.infer<typeof kickCountSchema>;

// Full sync request/response for wellness data
export const wellnessSyncSchema = z.object({
  moodEntries: z.array(moodEntrySchema).optional(),
  habits: z.array(habitSchema).optional(),
  goals: z.array(goalSchema).optional(),
  periodEntries: z.array(periodEntrySchema).optional(),
  periodSettings: periodSettingsSchema.optional(),
  feedingEntries: z.array(feedingEntrySchema).optional(),
  pregnancySymptoms: z.array(pregnancySymptomSchema).optional(),
  kickCounts: z.array(kickCountSchema).optional(),
});
export type WellnessSync = z.infer<typeof wellnessSyncSchema>;

// Full sync request/response for app data
export const appDataSyncSchema = z.object({
  todos: z.array(todoSchema).optional(),
  contents: z.array(contentIdeaSchema).optional(),
  events: z.array(calendarEventSchema).optional(),
});
export type AppDataSync = z.infer<typeof appDataSyncSchema>;

// ============================================
// Creator Profile Schema
// ============================================
export const creatorProfileSchema = z.object({
  id: z.string(),
  // ====== STEP 1: CREATOR DNA ======
  accountStandsFor: z.string().optional(),
  values: z.array(z.string()).optional(),
  customValues: z.array(z.string()).optional(),
  audienceTransformation: z.string().optional(),
  noGoPhrases: z.array(z.string()).optional(),
  customNoGoPhrases: z.array(z.string()).optional(),
  typicalPhrases: z.array(z.string()).optional(),
  // ====== STEP 2: ZIELGRUPPE ======
  audienceDescription: z.string().optional(),
  primaryPlatform: z.string().optional(),
  motivations: z.array(z.string()).optional(),
  customMotivations: z.array(z.string()).optional(),
  // ====== STEP 3: VOICE ======
  voiceStyle: z.string().optional(),
  neverUsePhrases: z.array(z.string()).optional(),
  alwaysUsePhrases: z.array(z.string()).optional(),
  // ====== STEP 4: CONTENT ======
  contentFormats: z.array(z.string()).optional(),
  contentTopics: z.array(z.string()).optional(),
  customTopics: z.array(z.string()).optional(),
  postingFrequency: z.string().optional(),
  // ====== STEP 5: WORKFLOW ======
  contentGoals: z.array(z.string()).optional(),
  currentLaunch: z.string().optional(),
  weeklyTimeInvestment: z.string().optional(),
  // Completion tracking
  isComplete: z.boolean(),
  completedAt: z.string().optional(),
  currentStep: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CreatorProfileSync = z.infer<typeof creatorProfileSchema>;

// Full sync request/response for creator profile
export const creatorProfileSyncSchema = z.object({
  creatorProfile: creatorProfileSchema.optional(),
});
export type CreatorProfileSyncData = z.infer<typeof creatorProfileSyncSchema>;

// Full sync response
export const fullSyncResponseSchema = z.object({
  profile: getUserProfileResponseSchema.optional(),
  creatorProfile: creatorProfileSchema.optional(),
  appData: appDataSyncSchema.optional(),
  wellness: wellnessSyncSchema.optional(),
  lastSyncedAt: z.string(),
});
export type FullSyncResponse = z.infer<typeof fullSyncResponseSchema>;

// ============================================
// AI Chat API Contracts
// ============================================

// POST /api/ai/chat
export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// POST /api/ai/image
export const postAIImageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
});
export type PostAIImageRequest = z.infer<typeof postAIImageRequestSchema>;

export const postAIImageResponseSchema = z.object({
  url: z.string(),
});
export type PostAIImageResponse = z.infer<typeof postAIImageResponseSchema>;

// POST /api/ai/transcribe
export const postAITranscribeRequestSchema = z.object({
  audioBase64: z.string().min(1).max(35_000_000),
  mimeType: z.string().default("audio/m4a"),
  language: z.string().optional(),
});
export type PostAITranscribeRequest = z.infer<typeof postAITranscribeRequestSchema>;

export const postAITranscribeResponseSchema = z.object({
  text: z.string(),
});
export type PostAITranscribeResponse = z.infer<typeof postAITranscribeResponseSchema>;

export const postAIChatRequestSchema = z.object({
  conversationId: z.string().optional(),
  messages: z.array(chatMessageSchema),
  creatorContext: z.string().optional(),
});
export type PostAIChatRequest = z.infer<typeof postAIChatRequestSchema>;

export const postAIChatResponseSchema = z.object({
  conversationId: z.string(),
  response: z.string(),
  messages: z.array(chatMessageSchema),
});
export type PostAIChatResponse = z.infer<typeof postAIChatResponseSchema>;

// POST /api/ai/ideas
export const postContentIdeasRequestSchema = z.object({
  audience: z.string(),
  niche: z.string(),
  tone: z.string(),
  platforms: z.array(z.string()),
  hooks: z.string().optional(),
});
export type PostContentIdeasRequest = z.infer<typeof postContentIdeasRequestSchema>;

export const postContentIdeasResponseSchema = z.object({
  ideas: z.array(z.string()),
});
export type PostContentIdeasResponse = z.infer<typeof postContentIdeasResponseSchema>;

// ============================================
// Content Analysis API Contracts
// ============================================

// POST /api/ai/analyze - Analyze content from links, images, or files
export const viralScoreSchema = z.object({
  score: z.number().min(1).max(100),
  hookClarity: z.number().min(1).max(10),
  storytelling: z.number().min(1).max(10),
  retentionPotential: z.number().min(1).max(10),
  uniqueness: z.number().min(1).max(10),
  emotionalImpact: z.number().min(1).max(10),
  improvements: z.string(),
});
export type ViralScore = z.infer<typeof viralScoreSchema>;

// Reel phase schema for detailed second-by-second Reel structure
const reelPhaseSchema = z.object({
  timeframe: z.string(),
  visualSuggestion: z.string(),
  textOverlaySuggestion: z.string(),
  emotionTrigger: z.string(),
  retentionPurpose: z.string(),
  timingGuidance: z.string(),
  callToAction: z.string().optional(),
});

const reelStructureSchema = z.object({
  hook: reelPhaseSchema.optional(),
  problemSetup: reelPhaseSchema.optional(),
  emotionalEscalation: reelPhaseSchema.optional(),
  turningPoint: reelPhaseSchema.optional(),
  resolutionCta: reelPhaseSchema.optional(),
});

export const contentAnalysisSchema = z.object({
  type: z.enum(["link", "image", "file"]), // Content type
  platform: z.string().optional(), // e.g., "instagram", "tiktok", "youtube"
  script: z.string().optional(), // Extracted or transcribed script
  scriptSummary: z.string().optional(), // Rewritten creator-friendly summary
  hookAnalysis: z.string().optional(), // Hook analysis and suggestions
  structure: z.string().optional(), // Content structure analysis
  viralScore: viralScoreSchema.optional(),
  creatorSuggestions: z.array(z.string()).optional(), // Actionable suggestions
  visualAnalysis: z.string().optional(), // For images - layout, hierarchy, optimization
  keyInsights: z.array(z.string()).optional(), // For files/documents
  aspectRatio: z.string().optional(), // Original aspect ratio for images
  contentOpportunities: z.array(z.string()).optional(), // For files
  reelStructure: reelStructureSchema.optional(), // 5-phase Reel structure with second-by-second timing
});
export type ContentAnalysis = z.infer<typeof contentAnalysisSchema>;

export const postContentAnalysisRequestSchema = z.object({
  contentType: z.enum(["link", "image", "file"]),
  url: z.string().optional(), // For links
  imageBase64: z.string().optional(), // For images (base64)
  fileBase64: z.string().optional(), // For files (base64)
  fileName: z.string().optional(), // Original file name
  platform: z.string().optional(), // Platform hint for link analysis
});
export type PostContentAnalysisRequest = z.infer<typeof postContentAnalysisRequestSchema>;

export const postContentAnalysisResponseSchema = z.object({
  success: z.boolean(),
  analysis: contentAnalysisSchema.optional(),
  error: z.string().optional(),
});
export type PostContentAnalysisResponse = z.infer<typeof postContentAnalysisResponseSchema>;

// POST /api/ai/viral-score - Detailed viral score analysis from a video URL
export const postViralScoreRequestSchema = z.object({
  url: z.string(),
  language: z.enum(["de", "en"]).optional(),
});
export type PostViralScoreRequest = z.infer<typeof postViralScoreRequestSchema>;

export const viralScoreDetailedSchema = z.object({
  score: z.number().min(1).max(100),
  platform: z.string(),
  url: z.string(),
  title: z.string().optional(),
  caption: z.string().optional(),
  hookClarity: z.number().min(1).max(10),
  storytelling: z.number().min(1).max(10),
  retentionPotential: z.number().min(1).max(10),
  uniqueness: z.number().min(1).max(10),
  emotionalImpact: z.number().min(1).max(10),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  improvements: z.array(z.string()),
});
export type ViralScoreDetailed = z.infer<typeof viralScoreDetailedSchema>;

export const postViralScoreResponseSchema = z.object({
  success: z.boolean(),
  data: viralScoreDetailedSchema.optional(),
  error: z.string().optional(),
});
export type PostViralScoreResponse = z.infer<typeof postViralScoreResponseSchema>;

// ============================================
// CSV Import API Contracts
// ============================================

// POST /api/csv-import/content-ideas
export const postCSVImportRequestSchema = z.object({
  csvContent: z.string(), // Raw CSV content as string
});
export type PostCSVImportRequest = z.infer<typeof postCSVImportRequestSchema>;

export const postCSVImportResponseSchema = z.object({
  success: z.boolean(),
  imported: z.number(),
  total: z.number(),
  skipped: z.number(),
  message: z.string(),
  error: z.string().optional(),
  details: z.any().optional(),
});
export type PostCSVImportResponse = z.infer<typeof postCSVImportResponseSchema>;

// POST /api/ai/extract-script
export const postExtractScriptRequestSchema = z.object({
  url: z.string().url(),
  language: z.enum(["en", "de"]).optional(),
});
export type PostExtractScriptRequest = z.infer<typeof postExtractScriptRequestSchema>;

export const postExtractScriptResponseSchema = z.object({
  success: z.boolean(),
  script: z.string().optional(),
  platform: z.string().optional(),
  hasTranscript: z.boolean().optional(),
  error: z.string().optional(),
});
export type PostExtractScriptResponse = z.infer<typeof postExtractScriptResponseSchema>;
