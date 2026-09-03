import type Database from 'better-sqlite3';
import {
  ConversationCitationDependencySnapshotSchema,
  type ConversationCitationDependencySnapshot,
  type ConversationUiMessage,
} from '@app/schemas';
import {
  createConversationCitationWorkspace,
  extractCanonicalCitationRefs,
  projectConversationCitationDependencies,
  projectConversationCitationRegistration,
} from '../../../../../../domains/citation/conversation-presentation';

import { SqliteConversationCitationFactIndex } from './sqliteCitationFactIndex';

export type UiMessageCitationDependencies = Readonly<
  Record<string, ConversationCitationDependencySnapshot>
>;

/**
 * 只读取窗口正文实际引用的 indexed facts，再按每条消息发生时点构造 dependency closure。
 * 完整工具历史的 admission 与规范化发生在 UI projection 写入/重建阶段。
 */
export function readUiMessageCitationDependencies(
  db: Database.Database,
  conversationId: string,
  messages: readonly ConversationUiMessage[]
): UiMessageCitationDependencies {
  const requests = messages.flatMap(message => {
    if (message.role !== 'assistant' || message.content === null) return [];
    const refs = extractCanonicalCitationRefs(message.content);
    return refs.length === 0 ? [] : [{ message, refs }];
  });
  if (requests.length === 0) return {};

  const latestMessageSortSeq = requests.reduce(
    (latest, request) => Math.max(latest, request.message.sort_seq),
    Number.NEGATIVE_INFINITY
  );
  const facts = new SqliteConversationCitationFactIndex(db).readFactsForRefs(
    conversationId,
    requests.flatMap(request => request.refs),
    latestMessageSortSeq
  );
  const orderedRequests = [...requests].sort(
    (left, right) => left.message.sort_seq - right.message.sort_seq
  );

  let workspace = createConversationCitationWorkspace();
  let factIndex = 0;
  const dependencies: Record<string, ConversationCitationDependencySnapshot> = {};
  for (const request of orderedRequests) {
    while (true) {
      const fact = facts[factIndex];
      if (!fact || fact.availableSortSeq >= request.message.sort_seq) break;
      workspace = projectConversationCitationRegistration(workspace, fact.scopeId, [fact.citation]);
      factIndex += 1;
    }
    dependencies[request.message.message_id] = ConversationCitationDependencySnapshotSchema.parse(
      projectConversationCitationDependencies(workspace, request.message.turn_id, request.refs)
    );
  }
  return dependencies;
}
