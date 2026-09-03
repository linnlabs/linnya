import { ConversationSelectedAgentIdSchema } from '@app/schemas';

/** Slides 插件拥有的 Agent 身份与 prompt key。 */
export const SLIDES_AGENT_ID = ConversationSelectedAgentIdSchema.parse('slides_agent');

export const SlidesPromptKeys = {
  SLIDES_AGENT: 'slides_agent',
} as const;

export type SlidesPromptKey = (typeof SlidesPromptKeys)[keyof typeof SlidesPromptKeys];
