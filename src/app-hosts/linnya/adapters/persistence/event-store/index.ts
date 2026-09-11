/**
 * @file src/app-hosts/linnya/adapters/persistence/event-store/index.ts
 * @description Linnya host persistence adapter 的 event-store 入口。
 */

export type {
  IEventStore,
  ConversationListItem,
  RunMetadata,
  RunSession,
  AppendEventToRunOptions,
  ReplaceUserInputEventOptions,
  ReplaceUserInputEventResult,
  TruncateHistoryFromEventResult,
  ReadRuntimeEventsOptions,
  RuntimeEventReadRoutingScope,
} from './event-store.interface';

export { SQLiteEventStore } from './sqlite.implementation';
export { readRuntimeEventsByIds } from './functions/readRuntimeEventsByIds';
export { readRunCheckpointInteractions } from './functions/readRunCheckpointInteractions';
export { LinnyaEventStoreAdapter } from './linnkit-event-store.adapter';
export { purgeStaleAuditEvents, type PurgeStaleAuditEventsOptions } from './auditMaintenance';
export {
  CONVERSATION_RUN_KIND,
  type ConversationRunKind,
} from '../definitions/conversationRunKind';
