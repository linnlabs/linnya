import { PromptKeys } from '../agent-registry/prompt.types';
import type { SubagentTypeContribution } from './types';

export const PLATFORM_SUBAGENT_TYPES: readonly SubagentTypeContribution[] = [
  {
    type: 'general',
    promptKey: PromptKeys.SUBAGENT_GENERAL,
    description: 'All-purpose subagent with search, read, and Workspace document creation capabilities.',
  },
  {
    type: 'document_editor',
    promptKey: PromptKeys.SUBAGENT_DOCUMENT_EDITOR,
    description: 'Markdown document editing with file operations and knowledge base access.',
  },
] as const;
