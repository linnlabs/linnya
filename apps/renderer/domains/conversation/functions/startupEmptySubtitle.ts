import type { ConversationMessageKey } from '../definitions/conversationMessages';

export const STARTUP_EMPTY_SUBTITLE_MESSAGE_KEYS = [
  'conversation.startupSubtitle.newProject',
  'conversation.startupSubtitle.linkInsights',
  'conversation.startupSubtitle.paper',
  'conversation.startupSubtitle.oneSentence',
  'conversation.startupSubtitle.newChapter',
  'conversation.startupSubtitle.todayThoughts',
  'conversation.startupSubtitle.captureIdea',
  'conversation.startupSubtitle.deepThinking',
  'conversation.startupSubtitle.projectToday',
  'conversation.startupSubtitle.focusedStart',
  'conversation.startupSubtitle.growthRings',
  'conversation.startupSubtitle.planToday',
  'conversation.startupSubtitle.goodStory',
  'conversation.startupSubtitle.thinkingRoots',
  'conversation.startupSubtitle.thinkingBranches',
] as const satisfies readonly ConversationMessageKey[];

export type StartupEmptySubtitleMessageKey = typeof STARTUP_EMPTY_SUBTITLE_MESSAGE_KEYS[number];

export function pickStartupEmptySubtitleIndex(randomValue = Math.random()): number {
  const normalizedRandom = Number.isFinite(randomValue)
    ? Math.min(0.999999, Math.max(0, randomValue))
    : 0;
  return Math.floor(normalizedRandom * STARTUP_EMPTY_SUBTITLE_MESSAGE_KEYS.length);
}
