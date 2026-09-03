import type { SearchResultCitation } from '@app/schemas';

/** Conversation 工具输出经过 producer owner schema 接纳后的引用事实。 */
export interface AdmittedConversationCitations {
  readonly citations: readonly SearchResultCitation[];
}
