import type { SearchResultCitation } from '@app/schemas';

/** scope 通常是 Runtime turn_id；调用方负责提供所属 Conversation/child run 的隔离容器。 */
export type ConversationCitationWorkspace = Map<
  string,
  ReadonlyMap<string, SearchResultCitation>
>;
