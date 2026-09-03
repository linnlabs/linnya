import autocompleteAgent from './autocomplete';
import annotationAgent from './annotation';
import audioSummaryAgent from './audio_summary';
import conversationTitleAgent from './conversation_title';
import translationAgent from './translation';
import writingAgent from './writing';

export const singleTurnAgentDefinitions = [
  autocompleteAgent,
  annotationAgent,
  audioSummaryAgent,
  conversationTitleAgent,
  translationAgent,
  writingAgent,
] as const;

export {
  autocompleteAgent,
  annotationAgent,
  audioSummaryAgent,
  conversationTitleAgent,
  translationAgent,
  writingAgent,
};
