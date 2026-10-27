import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { type AppType } from "../types";
import { db } from "../db";
import {
  userProfileSyncSchema,
  appDataSyncSchema,
  wellnessSyncSchema,
  creatorProfileSyncSchema,
  type FullSyncResponse,
  type GetUserProfileResponse,
  type AppDataSync,
  type WellnessSync,
} from "@/shared/contracts";

const syncRouter = new Hono<AppType>();

// ============================================
// Auth middleware for sync routes
// ============================================
syncRouter.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// ============================================
// GET /api/sync/all - Get all user data
// ============================================
syncRouter.get("/all", async (c) => {
  const user = c.get("user")!;
  console.log(`📥 [Sync] Fetching all data for user: ${user.id}`);

  try {
    // Fetch all data in parallel
    const [
      userProfile,
      creatorProfile,
      contents,
      todos,
      events,
      moodEntries,
      habits,
      goals,
      periodEntries,
      periodSettings,
      feedingEntries,
      pregnancySymptoms,
      kickCounts,
    ] = await Promise.all([
      db.userProfile.findUnique({ where: { userId: user.id } }),
      db.creatorProfile.findUnique({ where: { userId: user.id } }),
      db.contentIdea.findMany({ where: { userId: user.id } }),
      db.todo.findMany({ where: { userId: user.id } }),
      db.calendarEvent.findMany({ where: { userId: user.id } }),
      db.moodEntry.findMany({ where: { userId: user.id } }),
      db.habit.findMany({ where: { userId: user.id } }),
      db.goal.findMany({ where: { userId: user.id } }),
      db.periodEntry.findMany({ where: { userId: user.id } }),
      db.periodSettings.findUnique({ where: { userId: user.id } }),
      db.feedingEntry.findMany({ where: { userId: user.id } }),
      db.pregnancySymptom.findMany({ where: { userId: user.id } }),
      db.kickCount.findMany({ where: { userId: user.id } }),
    ]);

    // Transform data for response
    const profile: GetUserProfileResponse | undefined = userProfile
      ? {
          id: userProfile.id,
          firstName: userProfile.firstName ?? undefined,
          lastName: userProfile.lastName ?? undefined,
          displayName: userProfile.displayName ?? undefined,
          email: userProfile.email ?? undefined,
          profilePicture: userProfile.profilePicture,
          socialAccounts: userProfile.socialAccounts
            ? JSON.parse(userProfile.socialAccounts)
            : undefined,
          creatorNiches: userProfile.creatorNiches
            ? JSON.parse(userProfile.creatorNiches)
            : undefined,
          customNiche: userProfile.customNiche ?? undefined,
          creatorGoals: userProfile.creatorGoals
            ? JSON.parse(userProfile.creatorGoals)
            : undefined,
          postingStyle: userProfile.postingStyle,
          dashboardSections: userProfile.dashboardSections
            ? JSON.parse(userProfile.dashboardSections)
            : undefined,
          visionboardImages: userProfile.visionboardImages
            ? JSON.parse(userProfile.visionboardImages)
            : undefined,
          healthData: userProfile.healthData
            ? JSON.parse(userProfile.healthData)
            : undefined,
          analysisResults: userProfile.analysisResults
            ? JSON.parse(userProfile.analysisResults)
            : undefined,
          hasCompletedOnboarding: userProfile.hasCompletedOnboarding,
          hasCompletedAnalysis: userProfile.hasCompletedAnalysis,
        }
      : undefined;

    // Transform creator profile for response
    const creatorProfileData = creatorProfile
      ? {
          id: creatorProfile.id,
          // STEP 1: CREATOR DNA
          accountStandsFor: creatorProfile.accountStandsFor ?? undefined,
          values: creatorProfile.values ? JSON.parse(creatorProfile.values) : undefined,
          customValues: creatorProfile.customValues ? JSON.parse(creatorProfile.customValues) : undefined,
          audienceTransformation: creatorProfile.audienceTransformation ?? undefined,
          noGoPhrases: creatorProfile.noGoPhrases ? JSON.parse(creatorProfile.noGoPhrases) : undefined,
          customNoGoPhrases: creatorProfile.customNoGoPhrases ? JSON.parse(creatorProfile.customNoGoPhrases) : undefined,
          typicalPhrases: creatorProfile.typicalPhrases ? JSON.parse(creatorProfile.typicalPhrases) : undefined,
          // STEP 2: AUDIENCE
          audienceDescription: creatorProfile.audienceDescription ?? undefined,
          primaryPlatform: creatorProfile.primaryPlatform ?? undefined,
          motivations: creatorProfile.motivations ? JSON.parse(creatorProfile.motivations) : undefined,
          customMotivations: creatorProfile.customMotivations ? JSON.parse(creatorProfile.customMotivations) : undefined,
          // STEP 3: VOICE
          voiceStyle: creatorProfile.voiceStyle ?? undefined,
          neverUsePhrases: creatorProfile.neverUsePhrases ? JSON.parse(creatorProfile.neverUsePhrases) : undefined,
          alwaysUsePhrases: creatorProfile.alwaysUsePhrases ? JSON.parse(creatorProfile.alwaysUsePhrases) : undefined,
          // STEP 4: CONTENT
          contentFormats: creatorProfile.contentFormats ? JSON.parse(creatorProfile.contentFormats) : undefined,
          contentTopics: creatorProfile.contentTopics ? JSON.parse(creatorProfile.contentTopics) : undefined,
          customTopics: creatorProfile.customTopics ? JSON.parse(creatorProfile.customTopics) : undefined,
          postingFrequency: creatorProfile.postingFrequency ?? undefined,
          // STEP 5: WORKFLOW
          contentGoals: creatorProfile.contentGoals ? JSON.parse(creatorProfile.contentGoals) : undefined,
          currentLaunch: creatorProfile.currentLaunch ?? undefined,
          weeklyTimeInvestment: creatorProfile.weeklyTimeInvestment ?? undefined,
          // Completion tracking
          isComplete: creatorProfile.isComplete,
          completedAt: creatorProfile.completedAt?.toISOString() ?? undefined,
          currentStep: creatorProfile.currentStep,
          createdAt: creatorProfile.createdAt.toISOString(),
          updatedAt: creatorProfile.updatedAt.toISOString(),
        }
      : undefined;

    const appData: AppDataSync = {
      todos: todos.map((t) => ({
        id: t.id,
        text: t.text,
        dueDate: t.dueDate,
        priority: t.priority,
        completed: t.completed,
        createdAt: t.createdAt.toISOString(),
      })),
      contents: contents.map((c) => ({
        id: c.id,
        text: c.text,
        category: c.category,
        scheduledDate: c.scheduledDate,
        status: c.status,
        hook: c.hook ?? undefined,
        description: c.description ?? undefined,
        cta: c.cta ?? undefined,
        inspirations: c.inspirations ? JSON.parse(c.inspirations) : undefined,
        // ELLY Generation Tracking (NEW)
        isELLYGenerated: c.isELLYGenerated,
        generatedBy: c.generatedBy ?? undefined,
        suggestedDate: c.suggestedDate ?? undefined,
        generationPrompt: c.generationPrompt ?? undefined,
        generationModel: c.generationModel ?? undefined,
        createdAt: c.createdAt.toISOString(),
      })),
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date,
        time: e.time,
        endTime: e.endTime ?? undefined,
        notes: e.notes ?? undefined,
        isAllDay: e.isAllDay,
        isFromDevice: e.isFromDevice,
        calendarColor: e.calendarColor ?? undefined,
        syncCategory: e.syncCategory ?? undefined,
        createdAt: e.createdAt.toISOString(),
      })),
    };

    const wellness: WellnessSync = {
      moodEntries: moodEntries.map((m) => ({
        id: m.id,
        mood: m.mood,
        note: m.note ?? undefined,
        date: m.date,
        createdAt: m.createdAt.toISOString(),
      })),
      habits: habits.map((h) => ({
        id: h.id,
        name: h.name,
        icon: h.icon,
        color: h.color,
        frequency: h.frequency,
        completedDates: JSON.parse(h.completedDates),
        createdAt: h.createdAt.toISOString(),
      })),
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description ?? undefined,
        targetDate: g.targetDate ?? undefined,
        progress: g.progress,
        completed: g.completed,
        color: g.color,
        createdAt: g.createdAt.toISOString(),
      })),
      periodEntries: periodEntries.map((p) => ({
        id: p.id,
        startDate: p.startDate,
        endDate: p.endDate ?? undefined,
        flow: p.flow,
        symptoms: JSON.parse(p.symptoms),
        notes: p.notes ?? undefined,
        createdAt: p.createdAt.toISOString(),
      })),
      periodSettings: periodSettings
        ? {
            cycleLength: periodSettings.cycleLength,
            periodLength: periodSettings.periodLength,
            lastPeriodStart: periodSettings.lastPeriodStart ?? undefined,
            trackingEnabled: periodSettings.trackingEnabled,
            status: periodSettings.status,
            hasChosenTrackerType: periodSettings.hasChosenTrackerType,
            dueDate: periodSettings.dueDate ?? undefined,
            pregnancyStartDate: periodSettings.pregnancyStartDate ?? undefined,
            babyBirthDate: periodSettings.babyBirthDate ?? undefined,
          }
        : undefined,
      feedingEntries: feedingEntries.map((f) => ({
        id: f.id,
        date: f.date,
        time: f.time,
        side: f.side,
        duration: f.duration,
        type: f.type,
        notes: f.notes ?? undefined,
        createdAt: f.createdAt.toISOString(),
      })),
      pregnancySymptoms: pregnancySymptoms.map((p) => ({
        id: p.id,
        date: p.date,
        symptoms: JSON.parse(p.symptoms),
        notes: p.notes ?? undefined,
        createdAt: p.createdAt.toISOString(),
      })),
      kickCounts: kickCounts.map((k) => ({
        id: k.id,
        date: k.date,
        startTime: k.startTime,
        endTime: k.endTime ?? undefined,
        count: k.count,
        createdAt: k.createdAt.toISOString(),
      })),
    };

    const response: FullSyncResponse = {
      profile,
      creatorProfile: creatorProfileData,
      appData,
      wellness,
      lastSyncedAt: new Date().toISOString(),
    };

    console.log(`✅ [Sync] Successfully fetched all data for user: ${user.id}`);
    return c.json(response);
  } catch (error) {
    console.error(`❌ [Sync] Error fetching data:`, error);
    return c.json({ error: "Failed to fetch data" }, 500);
  }
});

// ============================================
// PUT /api/sync/profile - Update user profile
// ============================================
syncRouter.put("/profile", zValidator("json", userProfileSyncSchema), async (c) => {
  const user = c.get("user")!;
  const data = c.req.valid("json");
  console.log(`📤 [Sync] Updating profile for user: ${user.id}`);

  try {
    const profile = await db.userProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        firstName: data.firstName,
        lastName: data.lastName,
        displayName: data.displayName,
        email: data.email,
        profilePicture: data.profilePicture,
        socialAccounts: data.socialAccounts
          ? JSON.stringify(data.socialAccounts)
          : null,
        creatorNiches: data.creatorNiches
          ? JSON.stringify(data.creatorNiches)
          : null,
        customNiche: data.customNiche,
        creatorGoals: data.creatorGoals
          ? JSON.stringify(data.creatorGoals)
          : null,
        postingStyle: data.postingStyle,
        dashboardSections: data.dashboardSections
          ? JSON.stringify(data.dashboardSections)
          : null,
        visionboardImages: data.visionboardImages
          ? JSON.stringify(data.visionboardImages)
          : null,
        healthData: data.healthData ? JSON.stringify(data.healthData) : null,
        analysisResults: data.analysisResults
          ? JSON.stringify(data.analysisResults)
          : null,
        hasCompletedOnboarding: data.hasCompletedOnboarding ?? false,
        hasCompletedAnalysis: data.hasCompletedAnalysis ?? false,
      },
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        displayName: data.displayName,
        email: data.email,
        profilePicture: data.profilePicture,
        socialAccounts: data.socialAccounts
          ? JSON.stringify(data.socialAccounts)
          : undefined,
        creatorNiches: data.creatorNiches
          ? JSON.stringify(data.creatorNiches)
          : undefined,
        customNiche: data.customNiche,
        creatorGoals: data.creatorGoals
          ? JSON.stringify(data.creatorGoals)
          : undefined,
        postingStyle: data.postingStyle,
        dashboardSections: data.dashboardSections
          ? JSON.stringify(data.dashboardSections)
          : undefined,
        visionboardImages: data.visionboardImages
          ? JSON.stringify(data.visionboardImages)
          : undefined,
        healthData: data.healthData ? JSON.stringify(data.healthData) : undefined,
        analysisResults: data.analysisResults
          ? JSON.stringify(data.analysisResults)
          : undefined,
        hasCompletedOnboarding: data.hasCompletedOnboarding,
        hasCompletedAnalysis: data.hasCompletedAnalysis,
      },
    });

    console.log(`✅ [Sync] Profile updated for user: ${user.id}`);
    return c.json({ success: true, id: profile.id });
  } catch (error) {
    console.error(`❌ [Sync] Error updating profile:`, error);
    return c.json({ error: "Failed to update profile" }, 500);
  }
});

// ============================================
// PUT /api/sync/app-data - Update app data (todos, contents, events)
// ============================================
syncRouter.put("/app-data", zValidator("json", appDataSyncSchema), async (c) => {
  const user = c.get("user")!;
  const data = c.req.valid("json");
  console.log(`📤 [Sync] Updating app data for user: ${user.id}`);

  try {
    // Use transactions for atomic updates
    await db.$transaction(async (tx) => {
      // Sync todos
      if (data.todos) {
        // Delete existing todos
        await tx.todo.deleteMany({ where: { userId: user.id } });
        // Create new todos
        if (data.todos.length > 0) {
          await tx.todo.createMany({
            data: data.todos.map((t) => ({
              id: t.id,
              userId: user.id,
              text: t.text,
              dueDate: t.dueDate,
              priority: t.priority,
              completed: t.completed,
              createdAt: new Date(t.createdAt),
            })),
          });
        }
      }

      // Sync contents
      if (data.contents) {
        await tx.contentIdea.deleteMany({ where: { userId: user.id } });
        if (data.contents.length > 0) {
          await tx.contentIdea.createMany({
            data: data.contents.map((c) => ({
              id: c.id,
              userId: user.id,
              text: c.text,
              category: c.category,
              scheduledDate: c.scheduledDate,
              status: c.status,
              hook: c.hook,
              description: c.description,
              cta: c.cta,
              inspirations: c.inspirations
                ? JSON.stringify(c.inspirations)
                : null,
              // ELLY Generation Tracking (NEW)
              isELLYGenerated: c.isELLYGenerated ?? false,
              generatedBy: c.generatedBy,
              suggestedDate: c.suggestedDate,
              generationPrompt: c.generationPrompt,
              generationModel: c.generationModel,
              createdAt: new Date(c.createdAt),
            })),
          });
        }
      }

      // Sync events (only non-device events)
      if (data.events) {
        await tx.calendarEvent.deleteMany({
          where: { userId: user.id, isFromDevice: false },
        });
        const nonDeviceEvents = data.events.filter((e) => !e.isFromDevice);
        if (nonDeviceEvents.length > 0) {
          await tx.calendarEvent.createMany({
            data: nonDeviceEvents.map((e) => ({
              id: e.id,
              userId: user.id,
              title: e.title,
              date: e.date,
              time: e.time,
              endTime: e.endTime,
              notes: e.notes,
              isAllDay: e.isAllDay,
              isFromDevice: e.isFromDevice ?? false,
              calendarColor: e.calendarColor,
              syncCategory: e.syncCategory,
              createdAt: new Date(e.createdAt),
            })),
          });
        }
      }
    });

    console.log(`✅ [Sync] App data updated for user: ${user.id}`);
    return c.json({ success: true });
  } catch (error) {
    console.error(`❌ [Sync] Error updating app data:`, error);
    return c.json({ error: "Failed to update app data" }, 500);
  }
});

// ============================================
// PUT /api/sync/wellness - Update wellness data
// ============================================
syncRouter.put("/wellness", zValidator("json", wellnessSyncSchema), async (c) => {
  const user = c.get("user")!;
  const data = c.req.valid("json");
  console.log(`📤 [Sync] Updating wellness data for user: ${user.id}`);

  try {
    await db.$transaction(async (tx) => {
      // Sync mood entries
      if (data.moodEntries) {
        await tx.moodEntry.deleteMany({ where: { userId: user.id } });
        if (data.moodEntries.length > 0) {
          await tx.moodEntry.createMany({
            data: data.moodEntries.map((m) => ({
              id: m.id,
              userId: user.id,
              mood: m.mood,
              note: m.note,
              date: m.date,
              createdAt: new Date(m.createdAt),
            })),
          });
        }
      }

      // Sync habits
      if (data.habits) {
        await tx.habit.deleteMany({ where: { userId: user.id } });
        if (data.habits.length > 0) {
          await tx.habit.createMany({
            data: data.habits.map((h) => ({
              id: h.id,
              userId: user.id,
              name: h.name,
              icon: h.icon,
              color: h.color,
              frequency: h.frequency,
              completedDates: JSON.stringify(h.completedDates),
              createdAt: new Date(h.createdAt),
            })),
          });
        }
      }

      // Sync goals
      if (data.goals) {
        await tx.goal.deleteMany({ where: { userId: user.id } });
        if (data.goals.length > 0) {
          await tx.goal.createMany({
            data: data.goals.map((g) => ({
              id: g.id,
              userId: user.id,
              title: g.title,
              description: g.description,
              targetDate: g.targetDate,
              progress: g.progress,
              completed: g.completed,
              color: g.color,
              createdAt: new Date(g.createdAt),
            })),
          });
        }
      }

      // Sync period entries
      if (data.periodEntries) {
        await tx.periodEntry.deleteMany({ where: { userId: user.id } });
        if (data.periodEntries.length > 0) {
          await tx.periodEntry.createMany({
            data: data.periodEntries.map((p) => ({
              id: p.id,
              userId: user.id,
              startDate: p.startDate,
              endDate: p.endDate,
              flow: p.flow,
              symptoms: JSON.stringify(p.symptoms),
              notes: p.notes,
              createdAt: new Date(p.createdAt),
            })),
          });
        }
      }

      // Sync period settings
      if (data.periodSettings) {
        await tx.periodSettings.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            cycleLength: data.periodSettings.cycleLength,
            periodLength: data.periodSettings.periodLength,
            lastPeriodStart: data.periodSettings.lastPeriodStart,
            trackingEnabled: data.periodSettings.trackingEnabled,
            status: data.periodSettings.status,
            hasChosenTrackerType: data.periodSettings.hasChosenTrackerType,
            dueDate: data.periodSettings.dueDate,
            pregnancyStartDate: data.periodSettings.pregnancyStartDate,
            babyBirthDate: data.periodSettings.babyBirthDate,
          },
          update: {
            cycleLength: data.periodSettings.cycleLength,
            periodLength: data.periodSettings.periodLength,
            lastPeriodStart: data.periodSettings.lastPeriodStart,
            trackingEnabled: data.periodSettings.trackingEnabled,
            status: data.periodSettings.status,
            hasChosenTrackerType: data.periodSettings.hasChosenTrackerType,
            dueDate: data.periodSettings.dueDate,
            pregnancyStartDate: data.periodSettings.pregnancyStartDate,
            babyBirthDate: data.periodSettings.babyBirthDate,
          },
        });
      }

      // Sync feeding entries
      if (data.feedingEntries) {
        await tx.feedingEntry.deleteMany({ where: { userId: user.id } });
        if (data.feedingEntries.length > 0) {
          await tx.feedingEntry.createMany({
            data: data.feedingEntries.map((f) => ({
              id: f.id,
              userId: user.id,
              date: f.date,
              time: f.time,
              side: f.side,
              duration: f.duration,
              type: f.type,
              notes: f.notes,
              createdAt: new Date(f.createdAt),
            })),
          });
        }
      }

      // Sync pregnancy symptoms
      if (data.pregnancySymptoms) {
        await tx.pregnancySymptom.deleteMany({ where: { userId: user.id } });
        if (data.pregnancySymptoms.length > 0) {
          await tx.pregnancySymptom.createMany({
            data: data.pregnancySymptoms.map((p) => ({
              id: p.id,
              userId: user.id,
              date: p.date,
              symptoms: JSON.stringify(p.symptoms),
              notes: p.notes,
              createdAt: new Date(p.createdAt),
            })),
          });
        }
      }

      // Sync kick counts
      if (data.kickCounts) {
        await tx.kickCount.deleteMany({ where: { userId: user.id } });
        if (data.kickCounts.length > 0) {
          await tx.kickCount.createMany({
            data: data.kickCounts.map((k) => ({
              id: k.id,
              userId: user.id,
              date: k.date,
              startTime: k.startTime,
              endTime: k.endTime,
              count: k.count,
              createdAt: new Date(k.createdAt),
            })),
          });
        }
      }
    });

    console.log(`✅ [Sync] Wellness data updated for user: ${user.id}`);
    return c.json({ success: true });
  } catch (error) {
    console.error(`❌ [Sync] Error updating wellness data:`, error);
    return c.json({ error: "Failed to update wellness data" }, 500);
  }
});

// ============================================
// PUT /api/sync/creator-profile - Update creator profile
// ============================================
syncRouter.put("/creator-profile", zValidator("json", creatorProfileSyncSchema), async (c) => {
  const user = c.get("user")!;
  const data = c.req.valid("json");
  console.log(`📤 [Sync] Updating creator profile for user: ${user.id}`);

  try {
    if (data.creatorProfile) {
      const profile = data.creatorProfile;

      await db.creatorProfile.upsert({
        where: { userId: user.id },
        create: {
          id: profile.id,
          userId: user.id,
          // STEP 1: CREATOR DNA
          accountStandsFor: profile.accountStandsFor,
          values: profile.values ? JSON.stringify(profile.values) : null,
          customValues: profile.customValues ? JSON.stringify(profile.customValues) : null,
          audienceTransformation: profile.audienceTransformation,
          noGoPhrases: profile.noGoPhrases ? JSON.stringify(profile.noGoPhrases) : null,
          customNoGoPhrases: profile.customNoGoPhrases ? JSON.stringify(profile.customNoGoPhrases) : null,
          typicalPhrases: profile.typicalPhrases ? JSON.stringify(profile.typicalPhrases) : null,
          // STEP 2: AUDIENCE
          audienceDescription: profile.audienceDescription,
          primaryPlatform: profile.primaryPlatform,
          motivations: profile.motivations ? JSON.stringify(profile.motivations) : null,
          customMotivations: profile.customMotivations ? JSON.stringify(profile.customMotivations) : null,
          // STEP 3: VOICE
          voiceStyle: profile.voiceStyle,
          neverUsePhrases: profile.neverUsePhrases ? JSON.stringify(profile.neverUsePhrases) : null,
          alwaysUsePhrases: profile.alwaysUsePhrases ? JSON.stringify(profile.alwaysUsePhrases) : null,
          // STEP 4: CONTENT
          contentFormats: profile.contentFormats ? JSON.stringify(profile.contentFormats) : null,
          contentTopics: profile.contentTopics ? JSON.stringify(profile.contentTopics) : null,
          customTopics: profile.customTopics ? JSON.stringify(profile.customTopics) : null,
          postingFrequency: profile.postingFrequency,
          // STEP 5: WORKFLOW
          contentGoals: profile.contentGoals ? JSON.stringify(profile.contentGoals) : null,
          currentLaunch: profile.currentLaunch,
          weeklyTimeInvestment: profile.weeklyTimeInvestment,
          isComplete: profile.isComplete,
          completedAt: profile.completedAt ? new Date(profile.completedAt) : null,
          currentStep: profile.currentStep,
        },
        update: {
          // STEP 1: CREATOR DNA
          accountStandsFor: profile.accountStandsFor,
          values: profile.values ? JSON.stringify(profile.values) : null,
          customValues: profile.customValues ? JSON.stringify(profile.customValues) : null,
          audienceTransformation: profile.audienceTransformation,
          noGoPhrases: profile.noGoPhrases ? JSON.stringify(profile.noGoPhrases) : null,
          customNoGoPhrases: profile.customNoGoPhrases ? JSON.stringify(profile.customNoGoPhrases) : null,
          typicalPhrases: profile.typicalPhrases ? JSON.stringify(profile.typicalPhrases) : null,
          // STEP 2: AUDIENCE
          audienceDescription: profile.audienceDescription,
          primaryPlatform: profile.primaryPlatform,
          motivations: profile.motivations ? JSON.stringify(profile.motivations) : null,
          customMotivations: profile.customMotivations ? JSON.stringify(profile.customMotivations) : null,
          // STEP 3: VOICE
          voiceStyle: profile.voiceStyle,
          neverUsePhrases: profile.neverUsePhrases ? JSON.stringify(profile.neverUsePhrases) : null,
          alwaysUsePhrases: profile.alwaysUsePhrases ? JSON.stringify(profile.alwaysUsePhrases) : null,
          // STEP 4: CONTENT
          contentFormats: profile.contentFormats ? JSON.stringify(profile.contentFormats) : null,
          contentTopics: profile.contentTopics ? JSON.stringify(profile.contentTopics) : null,
          customTopics: profile.customTopics ? JSON.stringify(profile.customTopics) : null,
          postingFrequency: profile.postingFrequency,
          // STEP 5: WORKFLOW
          contentGoals: profile.contentGoals ? JSON.stringify(profile.contentGoals) : null,
          currentLaunch: profile.currentLaunch,
          weeklyTimeInvestment: profile.weeklyTimeInvestment,
          isComplete: profile.isComplete,
          completedAt: profile.completedAt ? new Date(profile.completedAt) : null,
          currentStep: profile.currentStep,
        },
      });
    }

    console.log(`✅ [Sync] Creator profile updated for user: ${user.id}`);
    return c.json({ success: true });
  } catch (error) {
    console.error(`❌ [Sync] Error updating creator profile:`, error);
    return c.json({ error: "Failed to update creator profile" }, 500);
  }
});

export { syncRouter };
