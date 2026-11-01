import { z } from 'zod';

import type {
  AppServerActivitySnapshot,
  AppServerPauseAgentRunsResult,
} from '../definitions/appServerActivityRpc';

const ConversationIdSchema = z.string().min(1);

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

const ActiveAgentRunSchema = z.object({
  conversation_id: ConversationIdSchema,
  conversation_title: z.string().nullable(),
}).strict();

const AppServerActivitySnapshotSchema = z.object({
  has_executing_commands: z.boolean(),
  active_agent_runs: z.array(ActiveAgentRunSchema).refine(
    runs => !hasDuplicates(runs.map(run => run.conversation_id)),
    '每个对话最多一项活跃 Agent run',
  ),
  knowledge_ingestion_active: z.boolean(),
}).strict();

const AppServerPauseAgentRunsResultSchema = z.object({
  paused_conversation_ids: z.array(ConversationIdSchema),
  unpausable_conversation_ids: z.array(ConversationIdSchema),
}).strict().refine(
  result => !hasDuplicates([
    ...result.paused_conversation_ids,
    ...result.unpausable_conversation_ids,
  ]),
  '同一对话只能归入一种暂停结果',
);

type AppServerActivitySnapshotWire = z.infer<typeof AppServerActivitySnapshotSchema>;
type AppServerPauseAgentRunsResultWire = z.infer<typeof AppServerPauseAgentRunsResultSchema>;

export function parseAppServerActivityReadRequest(value: unknown): null {
  return z.null().parse(value);
}

export function parseAppServerPauseAgentRunsRequest(value: unknown): null {
  return z.null().parse(value);
}

export function encodeAppServerActivitySnapshot(
  snapshot: AppServerActivitySnapshot,
): AppServerActivitySnapshotWire {
  return AppServerActivitySnapshotSchema.parse({
    has_executing_commands: snapshot.hasExecutingCommands,
    active_agent_runs: snapshot.activeAgentRuns.map(run => ({
      conversation_id: run.conversationId,
      conversation_title: run.conversationTitle,
    })),
    knowledge_ingestion_active: snapshot.knowledgeIngestionActive,
  });
}

export function parseAppServerActivitySnapshot(value: unknown): AppServerActivitySnapshot {
  const parsed = AppServerActivitySnapshotSchema.parse(value);
  return Object.freeze({
    hasExecutingCommands: parsed.has_executing_commands,
    activeAgentRuns: Object.freeze(parsed.active_agent_runs.map(run => Object.freeze({
      conversationId: run.conversation_id,
      conversationTitle: run.conversation_title,
    }))),
    knowledgeIngestionActive: parsed.knowledge_ingestion_active,
  });
}

export function encodeAppServerPauseAgentRunsResult(
  result: AppServerPauseAgentRunsResult,
): AppServerPauseAgentRunsResultWire {
  return AppServerPauseAgentRunsResultSchema.parse({
    paused_conversation_ids: [...result.pausedConversationIds],
    unpausable_conversation_ids: [...result.unpausableConversationIds],
  });
}

export function parseAppServerPauseAgentRunsResult(value: unknown): AppServerPauseAgentRunsResult {
  const parsed = AppServerPauseAgentRunsResultSchema.parse(value);
  return Object.freeze({
    pausedConversationIds: Object.freeze([...parsed.paused_conversation_ids]),
    unpausableConversationIds: Object.freeze([...parsed.unpausable_conversation_ids]),
  });
}
