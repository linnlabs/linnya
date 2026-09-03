import type {
  AuditDocumentCommonMetadata,
  ContextManagerAuditEntry,
  LLMAuditContext,
  RunAuditState,
} from '../definitions/llmRunAudit';
import { formatBeijingTime } from './auditTime';
import { buildToolProtocolReplayInput, cloneAuditValue } from './auditValues';

export function buildCheckpointDocument(params: {
  runAudit: RunAuditState;
  context: LLMAuditContext;
  seq: number;
}): Record<string, unknown> {
  return {
    startedAt: params.runAudit.startedAtIso,
    updatedAt: new Date().toISOString(),
    stage: 'in_progress',
    seq: params.seq,
    audit_context: cloneAuditValue(params.context),
    byRunKey: cloneAuditValue(params.runAudit.byRunKey),
  };
}

export function buildFinalAuditDocuments(params: {
  runAudit: RunAuditState;
  auditContext?: ContextManagerAuditEntry['audit_context'];
  flushedAt: Date;
}): {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  toolProtocolErrors: Record<string, unknown>;
} {
  const startedAt = new Date(params.runAudit.startedAtIso);
  const commonMeta: AuditDocumentCommonMetadata = {
    startedAt: params.runAudit.startedAtIso,
    startedAtBeijing: formatBeijingTime(startedAt),
    flushedAt: params.flushedAt.toISOString(),
    flushedAtBeijing: formatBeijingTime(params.flushedAt),
    audit_context: params.auditContext,
  };
  const rootBucket = params.runAudit.byRunKey.root;
  const subrunBuckets = Object.entries(params.runAudit.byRunKey)
    .filter(([key]) => key !== 'root')
    .map(([, bucket]) => bucket);
  const subrunProtocolErrors = subrunBuckets.flatMap((bucket) => bucket.toolProtocolErrors ?? []);

  return {
    before: {
      ...commonMeta,
      stage: 'before_context_manager',
      root: rootBucket?.before ?? null,
    },
    after: {
      ...commonMeta,
      stage: 'after_context_manager',
      root: rootBucket?.after ?? null,
      root_system_reminder_hits: rootBucket?.systemReminderAfterSnapshots ?? [],
      root_system_reminder_hits_dropped_count: rootBucket?.systemReminderAfterSnapshotsDroppedCount ?? 0,
      root_transcript: rootBucket?.transcript ?? null,
      subrun_transcripts: subrunBuckets.map((bucket) => bucket.transcript ?? null).filter(isPresent),
      root_materialization_attempts: rootBucket?.materializationAttempts ?? [],
      subrun_materialization_attempts: subrunBuckets.flatMap(
        (bucket) => bucket.materializationAttempts ?? [],
      ),
    },
    toolProtocolErrors: {
      ...commonMeta,
      stage: 'tool_protocol_errors',
      root: rootBucket?.toolProtocolErrors ?? [],
      root_dropped_count: rootBucket?.toolProtocolErrorsDroppedCount ?? 0,
      subrun_errors: subrunProtocolErrors,
      subrun_errors_dropped_count: subrunBuckets.reduce(
        (total, bucket) => total + (bucket.toolProtocolErrorsDroppedCount ?? 0),
        0,
      ),
      replay_input: buildToolProtocolReplayInput([
        ...(rootBucket?.toolProtocolErrors ?? []),
        ...subrunProtocolErrors,
      ]),
    },
  };
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
