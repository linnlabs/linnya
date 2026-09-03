/**
 * @file src/app-hosts/linnya/adapters/telemetry/sqlite.implementation.ts
 * @description Linnya 宿主侧 TelemetryPort 的 SQLite + logger 双 sink 实现。
 *
 * 实现 linnkit 的 TelemetryPort 接口，把 engine 通过 emit() 发出的事件：
 * 1) 写 workspace.sqlite 的 engine_telemetry 表（窄表 + JSON payload，详见 README §3）
 * 2) 同时写一条 logger.info（单行 inline 关键字段，方便实时跟）
 *
 * 设计要点：
 * - emit 是 fire-and-forget：SQLite 写失败不能让 engine 崩，包 try/catch + logger.warn
 *   （和 SqliteCheckpointer.save 不同——后者失败必须暴露，因为关系到状态正确性）
 * - flush(): noop（better-sqlite3 是同步的，每条 emit 已直接落盘，没有缓冲）
 * - purgeStale: 宿主层 GC（不在 TelemetryPort 接口上），按 emitted_at 老化清理。
 *   telemetry 是 debug 用，老数据无价值，默认窗口比 checkpoint 短（建议 7 天）。
 *
 * scope 拍平规则：
 * - conversationId / runId / parentRunId / turnId / stepId 拍到列上（便于 WHERE + 索引）
 * - durationMs 也拍到列上（当前 6 类事件中 4 类都有，常用查询条件）
 * - 其他事件特有字段（modelId / toolName / nodeId / phase / usage / errorCode 等）
 *   原样保留在 payload JSON 里，linnkit 演化时不需要改 schema
 */

import type Database from 'better-sqlite3';
import { z } from 'zod';

import { CanonicalLlmUsage } from 'linnkit/contracts';
import { telemetry } from 'linnkit/runtime-kernel';
import type { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type { LinnyaTokenCalibrationCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type {
  ExecutionAuditTelemetryPort,
  ExecutionAuditTelemetryRecord,
  ExecutionAuditUsage,
} from 'src/app-hosts/linnya/application/execution-audit-export';

type TelemetryPort = telemetry.TelemetryPort;
type TelemetryEvent = telemetry.TelemetryEvent;

/**
 * 轻量 logger 接口——避免直接依赖具体 Logger 实现，方便测试注入。
 * 与 src/shared/logger.ts 的 Logger 类签名兼容。
 */
export interface TelemetryLoggerLike {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
}

const NOOP_LOGGER: TelemetryLoggerLike = {
  info: () => {},
  warn: () => {},
};

const ExecutionAuditTelemetryRowSchema = z.object({
  event_kind: z.enum(['llm_call', 'tool_call', 'context_compaction', 'run_lifecycle']),
  run_id: z.string().nullable(),
  parent_run_id: z.string().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  payload: z.string(),
  emitted_at: z.number().finite().nonnegative(),
}).strict();

const ExecutionAuditTelemetryPayloadSchema = z.union([
  z.object({
    kind: z.literal('llm_call'),
    modelId: z.string().min(1),
    canonicalUsage: CanonicalLlmUsage.optional(),
  }).passthrough(),
  z.object({
    kind: z.literal('tool_call'),
    toolName: z.string().min(1),
    ok: z.boolean(),
    errorCode: z.string().min(1).optional(),
  }).passthrough(),
  z.object({
    kind: z.literal('context_compaction'),
    modelId: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    compactionIndex: z.number().int().positive(),
    maxCompactionsPerRun: z.number().int().positive(),
    generationAttempted: z.boolean(),
    triggerRatio: z.number().min(0).max(1),
    targetRatio: z.number().min(0).max(1),
    beforeTokens: z.number().int().nonnegative(),
    inputBudgetTokens: z.number().int().nonnegative(),
    compactionInputTokens: z.number().int().nonnegative().optional(),
    afterTokens: z.number().int().nonnegative().optional(),
    replacedMessageCount: z.number().int().nonnegative(),
    replacedToolGroupCount: z.number().int().nonnegative(),
    keptToolGroupCount: z.number().int().nonnegative(),
    summaryOutputTokens: z.number().int().nonnegative().optional(),
    compressionRatio: z.number().nonnegative().optional(),
    canonicalUsage: CanonicalLlmUsage.optional(),
    outcome: z.enum(['skipped', 'completed', 'failed', 'insufficient', 'aborted']),
    suppressedReason: z.string().min(1).optional(),
    forcedPhaseRecovery: z.boolean(),
    targetUnreachable: z.boolean().optional(),
    errorCode: z.string().min(1).optional(),
    failureReason: z.string().min(1).optional(),
  }).passthrough(),
  z.object({
    kind: z.literal('run_lifecycle'),
    phase: z.literal('spawned'),
  }).passthrough(),
  z.object({
    kind: z.literal('run_lifecycle'),
    phase: z.enum(['completed', 'failed', 'cancelled']),
    stepsUsed: z.number().int().nonnegative(),
    maxSteps: z.number().int().positive(),
    terminalReason: z.enum([
      'completed',
      'awaiting_user',
      'step_budget_forced_completion',
      'step_budget_exhausted',
      'capacity_failed',
      'failed',
      'cancelled',
    ]),
  }).passthrough(),
]);

export class SqliteTelemetryAdapter implements TelemetryPort, ExecutionAuditTelemetryPort {
  constructor(
    private readonly db: Database.Database,
    private readonly logger: TelemetryLoggerLike = NOOP_LOGGER,
    private readonly runCostCollector?: LinnyaRunCostCollector,
    private readonly tokenCalibrationCollector?: LinnyaTokenCalibrationCollector,
  ) {}

  emit(event: TelemetryEvent): void {
    const emittedAt = Date.now();
    const scope = event.scope ?? {};
    // run_lifecycle 自带权威 runId；初态加载失败时 scope 刻意为空，仍不能丢失已知身份。
    const runId = event.kind === 'run_lifecycle' ? event.runId : scope.runId;
    const durationMs = 'durationMs' in event ? event.durationMs : null;

    try {
      this.db
        .prepare(
          `
          INSERT INTO engine_telemetry (
            event_kind,
            conversation_id,
            run_id,
            parent_run_id,
            turn_id,
            step_id,
            duration_ms,
            payload,
            emitted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          event.kind,
          scope.conversationId ?? null,
          runId ?? null,
          scope.parentRunId ?? null,
          scope.turnId ?? null,
          scope.stepId ?? null,
          durationMs,
          JSON.stringify(event),
          emittedAt,
        );
    } catch (err) {
      this.logger.warn('[telemetry] SQLite emit failed', {
        kind: event.kind,
        error: err,
      });
    }

    this.logger.info(formatLogLine(event));
    this.ingestCollectors(event);
  }

  async flush(): Promise<void> {
    // better-sqlite3 是同步 API，emit 已立即落盘，无缓冲可刷
  }

  /**
   * 宿主层 GC：清理过期 telemetry 记录。
   *
   * 不在 TelemetryPort 接口上——平台层不规定 GC 策略，留给宿主自定义。
   * telemetry 是事后排查 debug 用，老数据无价值，默认窗口建议 7 天即可。
   *
   * @returns 实际删除的行数
   */
  purgeStale(opts: { olderThanMs: number; now?: number }): number {
    const now = opts.now ?? Date.now();
    const cutoff = now - opts.olderThanMs;

    const result = this.db
      .prepare('DELETE FROM engine_telemetry WHERE emitted_at < ?')
      .run(cutoff);

    return Number(result.changes);
  }

  async listByConversation(
    conversationId: string,
  ): Promise<readonly ExecutionAuditTelemetryRecord[]> {
    const rows = this.db.prepare(`
      SELECT event_kind, run_id, parent_run_id, duration_ms, payload, emitted_at
      FROM engine_telemetry
      WHERE conversation_id = ?
        AND event_kind IN ('llm_call', 'tool_call', 'context_compaction', 'run_lifecycle')
      ORDER BY emitted_at ASC, id ASC
    `).all(conversationId);
    const records: ExecutionAuditTelemetryRecord[] = [];

    for (const rawRow of rows) {
      const row = ExecutionAuditTelemetryRowSchema.safeParse(rawRow);
      if (!row.success) {
        this.logger.warn('[telemetry] execution audit skipped an invalid row', {
          conversationId,
          issues: row.error.issues,
        });
        continue;
      }
      let rawPayload: unknown;
      try {
        rawPayload = JSON.parse(row.data.payload);
      } catch (error: unknown) {
        this.logger.warn('[telemetry] execution audit skipped invalid JSON', {
          conversationId,
          error,
        });
        continue;
      }
      const payload = ExecutionAuditTelemetryPayloadSchema.safeParse(rawPayload);
      if (!payload.success || payload.data.kind !== row.data.event_kind) {
        this.logger.warn('[telemetry] execution audit skipped an invalid payload', {
          conversationId,
          issues: payload.success ? ['event kind mismatch'] : payload.error.issues,
        });
        continue;
      }
      const base = {
        runId: row.data.run_id ?? undefined,
        parentRunId: row.data.parent_run_id ?? undefined,
        emittedAt: row.data.emitted_at,
      };
      if (payload.data.kind === 'llm_call') {
        if (row.data.duration_ms === null) continue;
        records.push({
          ...base,
          durationMs: row.data.duration_ms,
          kind: 'llm_call',
          modelId: payload.data.modelId,
          usage: projectExecutionAuditUsage(payload.data.canonicalUsage),
        });
      } else if (payload.data.kind === 'tool_call') {
        if (row.data.duration_ms === null) continue;
        records.push({
          ...base,
          durationMs: row.data.duration_ms,
          kind: 'tool_call',
          toolName: payload.data.toolName,
          ok: payload.data.ok,
          errorCode: payload.data.errorCode,
        });
      } else if (payload.data.kind === 'context_compaction') {
        if (row.data.duration_ms === null) continue;
        records.push({
          ...base,
          kind: 'context_compaction',
          modelId: payload.data.modelId,
          durationMs: row.data.duration_ms,
          compactionIndex: payload.data.compactionIndex,
          maxCompactionsPerRun: payload.data.maxCompactionsPerRun,
          generationAttempted: payload.data.generationAttempted,
          triggerRatio: payload.data.triggerRatio,
          targetRatio: payload.data.targetRatio,
          beforeTokens: payload.data.beforeTokens,
          inputBudgetTokens: payload.data.inputBudgetTokens,
          compactionInputTokens: payload.data.compactionInputTokens,
          afterTokens: payload.data.afterTokens,
          replacedMessageCount: payload.data.replacedMessageCount,
          replacedToolGroupCount: payload.data.replacedToolGroupCount,
          keptToolGroupCount: payload.data.keptToolGroupCount,
          summaryOutputTokens: payload.data.summaryOutputTokens,
          compressionRatio: payload.data.compressionRatio,
          usage: projectExecutionAuditUsage(payload.data.canonicalUsage),
          outcome: payload.data.outcome,
          suppressedReason: payload.data.suppressedReason,
          forcedPhaseRecovery: payload.data.forcedPhaseRecovery,
          targetUnreachable: payload.data.targetUnreachable,
          errorCode: payload.data.errorCode,
          failureReason: payload.data.failureReason,
        });
      } else if (payload.data.phase !== 'spawned') {
        records.push({
          ...base,
          kind: 'run_lifecycle',
          phase: payload.data.phase,
          stepsUsed: payload.data.stepsUsed,
          maxSteps: payload.data.maxSteps,
          terminalReason: payload.data.terminalReason,
        });
      }
    }

    return records;
  }

  private ingestCollectors(event: TelemetryEvent): void {
    if (event.kind === 'llm_call' || event.kind === 'context_build') {
      this.runCostCollector?.ingestTelemetry(event);
    }
    this.tokenCalibrationCollector?.ingestTelemetry(event);
  }
}

function projectExecutionAuditUsage(
  usage: z.infer<typeof CanonicalLlmUsage> | undefined,
): ExecutionAuditUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    confidence: usage.confidence,
  };
}

/**
 * 单行 inline 格式：方便实时 tail。
 *
 * 例：[telemetry] llm_call duration_ms=1234 conv=conv_abc model=gpt-5 stream=true
 */
function formatLogLine(event: TelemetryEvent): string {
  const scope = event.scope ?? {};
  const runId = event.kind === 'run_lifecycle' ? event.runId : scope.runId;
  const parts: string[] = [`[telemetry] ${event.kind}`];

  if ('durationMs' in event) {
    parts.push(`duration_ms=${event.durationMs}`);
  }
  if (scope.conversationId) parts.push(`conv=${scope.conversationId}`);
  if (runId) parts.push(`run=${runId}`);
  if (scope.parentRunId) parts.push(`parent=${scope.parentRunId}`);
  if (scope.turnId) parts.push(`turn=${scope.turnId}`);

  switch (event.kind) {
    case 'llm_call':
      parts.push(`model=${event.modelId}`, `stream=${event.stream}`);
      if (event.usage) {
        parts.push(`tokens_in=${event.usage.promptTokens}`);
        parts.push(`tokens_out=${event.usage.completionTokens}`);
      }
      break;
    case 'tool_call':
      parts.push(`name=${event.toolName}`, `ok=${event.ok}`);
      if (event.errorCode) parts.push(`error=${event.errorCode}`);
      break;
    case 'context_compaction':
      parts.push(
        `model=${event.modelId}`,
        `outcome=${event.outcome}`,
        `index=${event.compactionIndex}/${event.maxCompactionsPerRun}`,
        `tokens_before=${event.beforeTokens}`,
      );
      if (event.afterTokens !== undefined) parts.push(`tokens_after=${event.afterTokens}`);
      if (event.suppressedReason) parts.push(`reason=${event.suppressedReason}`);
      if (event.errorCode) parts.push(`error=${event.errorCode}`);
      break;
    case 'graph_node':
      parts.push(`node=${event.nodeId}`);
      break;
    case 'run_lifecycle':
      parts.push(`phase=${event.phase}`);
      if (event.phase !== 'spawned') {
        parts.push(
          `steps=${event.stepsUsed}/${event.maxSteps}`,
          `terminal=${event.terminalReason}`,
        );
      }
      break;
  }

  return parts.join(' ');
}
