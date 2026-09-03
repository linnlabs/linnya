import { createHash } from 'crypto';
import type { LiveEvidenceBundleKind } from '../../../definitions/evidence';
import type { LiveEvidenceBundleRecordV1 } from '../definitions/evidenceBundleRecord';
import type { SaveEvidenceBundleCommand } from '../definitions/evidenceBundleWrite';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function buildBundleIdentityItems(command: SaveEvidenceBundleCommand): readonly UnknownRecord[] {
  if (command.kind === 'knowledge_evidence') {
    return command.items.map(item => ({
      ref_id: item.ref_id,
      doc_id: item.doc_id,
      block_id: item.block_id,
      capture_kind: item.capture_kind,
      content_text: item.content_text,
    }));
  }
  return command.items.map(item => ({
    ref_id: item.ref_id,
    normalized_url: item.normalized_url,
    capture_kind: item.capture_kind,
    content_text: item.content_text,
  }));
}

function computeBundleId(params: {
  readonly conversationId: string;
  readonly kind: LiveEvidenceBundleKind;
  readonly query: string;
  readonly items: readonly UnknownRecord[];
}): string {
  const seed = stableStringify({
    v: 1,
    kind: params.kind,
    scope: params.conversationId,
    key: { query: params.query, items: params.items },
  });
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

/** 构建确定性 bundle identity 和 live persistence record，不执行 I/O。 */
export function createEvidenceBundleRecord(params: {
  readonly conversationId: string;
  readonly command: SaveEvidenceBundleCommand;
  readonly createdAtMs: number;
}): { readonly bundleId: string; readonly record: LiveEvidenceBundleRecordV1 } {
  const bundleId = computeBundleId({
    conversationId: params.conversationId,
    kind: params.command.kind,
    query: params.command.query,
    items: buildBundleIdentityItems(params.command),
  });
  const common = {
    version: 1 as const,
    created_at_ms: params.createdAtMs,
    conversation_id: params.conversationId,
    turn_id: params.command.audit?.turnId,
    tool_call_id: params.command.audit?.toolCallId,
    query: params.command.query,
    summary: params.command.summary,
  };
  const record: LiveEvidenceBundleRecordV1 =
    params.command.kind === 'knowledge_evidence'
      ? { ...common, kind: 'knowledge_evidence', items: params.command.items }
      : { ...common, kind: 'web_evidence', items: params.command.items };
  return { bundleId, record };
}
