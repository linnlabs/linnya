import { createHash } from 'crypto';
import type { ToolExecutionContext } from '../toolExecutionContext';
import type { RuntimeEvent, RuntimeResourceRef } from '../../../contracts';

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export type ToolIdempotencyScope = 'conversation' | 'turn';

export type ToolIdempotencyPolicy = {
  scope: ToolIdempotencyScope;
};

function stableStringify(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'string') return JSON.stringify(v);
  if (t === 'number' || t === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isRecord(v)) {
    const keys = Object.keys(v).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(String(v));
}

function resolveScopeKey(scope: ToolIdempotencyScope, context: ToolExecutionContext): string {
  if (scope === 'conversation') {
    const conversationId = context.conversationId;
    if (typeof conversationId === 'string' && conversationId.trim().length > 0) {
      return conversationId.trim();
    }
    throw new Error('Tool idempotency scope "conversation" requires ToolExecutionContext.conversationId.');
  }

  if (scope === 'turn') {
    const turnId = context.turnId;
    if (typeof turnId === 'string' && turnId.trim().length > 0) {
      return turnId.trim();
    }
    throw new Error('Tool idempotency scope "turn" requires ToolExecutionContext.turnId.');
  }

  const unsupportedScope: never = scope;
  throw new Error(`Unsupported tool idempotency scope: ${String(unsupportedScope)}`);
}

export function computeToolIdempotencyKey(params: {
  policy: ToolIdempotencyPolicy;
  toolName: string;
  args: Record<string, unknown>;
  context: ToolExecutionContext;
}): string {
  const scopeKey = resolveScopeKey(params.policy.scope, params.context);
  const json = stableStringify({ tool: params.toolName, args: params.args });
  return createHash('sha256').update(`${scopeKey}|${json}`).digest('hex').slice(0, 32);
}

export function findCachedToolOutputByIdempotencyKey(params: {
  history: ReadonlyArray<RuntimeEvent>;
  toolName: string;
  idempotencyKey: string;
}): { result: string; attachments?: readonly RuntimeResourceRef[] } | undefined {
  for (let i = params.history.length - 1; i >= 0; i -= 1) {
    const e = params.history[i];
    if (e.type !== 'tool_output') continue;
    if (e.tool_name !== params.toolName) continue;
    if (e.status !== 'success') continue;
    const meta = e.metadata;
    if (!isRecord(meta)) continue;
    const idem = meta['idempotency'];
    if (!isRecord(idem)) continue;
    if (idem['key'] !== params.idempotencyKey) continue;
    const structuredResult: UnknownRecord = { data: e.data, observation: e.observation };
    const presentation = meta?.presentation;
    if (isRecord(presentation) && presentation['media'] !== undefined) {
      structuredResult['media'] = presentation['media'];
    }
    return {
      result: JSON.stringify(structuredResult),
      ...(e.attachments ? { attachments: e.attachments } : {}),
    };
  }
  return undefined;
}
