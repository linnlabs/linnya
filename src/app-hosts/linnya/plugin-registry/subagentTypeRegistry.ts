import { PromptKeys } from '../agent-registry/prompt.types';
import type { SubagentTypeContribution } from './types';

export const PLATFORM_SUBAGENT_TYPES: readonly SubagentTypeContribution[] = [
  {
    type: 'general',
    promptKey: PromptKeys.SUBAGENT_GENERAL,
    description:
      'All-purpose subagent with search, read, and Workspace document creation capabilities.',
  },
  {
    type: 'document_editor',
    promptKey: PromptKeys.SUBAGENT_DOCUMENT_EDITOR,
    description: 'Markdown document editing with file operations and knowledge base access.',
  },
  {
    type: 'research_investigation',
    promptKey: PromptKeys.RESEARCH_AUTHOR_V1,
    description: '调查问题、竞争解释与区分性证据，保存调查记录。',
  },
  {
    type: 'research_investigation_review',
    promptKey: PromptKeys.RESEARCH_INVESTIGATION_REVIEW_V1,
    description: '独立复核调查覆盖、关键机制与缺口，保存原始意见。',
  },
  {
    type: 'research_argument_review',
    promptKey: PromptKeys.RESEARCH_ARGUMENT_REVIEW_V1,
    description: '独立检查指定初稿的论证、解释与可读性，不读取同轮来源评审。',
  },
  {
    type: 'research_source_review',
    promptKey: PromptKeys.RESEARCH_SOURCE_REVIEW_V1,
    description: '独立检查指定初稿的原始来源、数字与比较，不读取同轮论证评审。',
  },
] as const;
