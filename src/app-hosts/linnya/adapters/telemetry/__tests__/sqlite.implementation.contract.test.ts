/**
 * @file src/app-hosts/linnya/adapters/telemetry/__tests__/sqlite.implementation.contract.test.ts
 * @description SqliteTelemetryAdapter 合约测试。
 *
 * 覆盖：
 * - emit() 把全部事件正确落盘 + 拍平 scope/duration_ms 列
 * - emit() 同时写 logger.info（双 sink）
 * - emit() SQLite 写失败时不抛异常 + 写 logger.warn
 * - flush() 是 noop
 * - purgeStale() 按 emitted_at 老化清理
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ENGINE_TELEMETRY_SCHEMA } from '../telemetry.schema';
import {
  SqliteTelemetryAdapter,
  type TelemetryLoggerLike,
} from '../sqlite.implementation';
import { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import { LinnyaTokenCalibrationCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type { telemetry } from 'linnkit/runtime-kernel';
import type { TokenRoute } from 'linnkit/contracts';

type TelemetryEvent = telemetry.TelemetryEvent;

const route: TokenRoute = {
  capabilityId: 'openrouter',
  baseURL: 'https://openrouter.ai/api/v1',
  modelId: 'glm-via-openrouter',
  endpointModelId: 'z-ai/glm-4.5',
};

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  for (const stmt of ENGINE_TELEMETRY_SCHEMA) {
    db.exec(stmt);
  }
  return db;
}

function spyLogger(): TelemetryLoggerLike & {
  infoCalls: Array<{ message: string; data?: unknown }>;
  warnCalls: Array<{ message: string; data?: unknown }>;
} {
  const infoCalls: Array<{ message: string; data?: unknown }> = [];
  const warnCalls: Array<{ message: string; data?: unknown }> = [];
  return {
    info: (message, data) => {
      infoCalls.push({ message, data });
    },
    warn: (message, data) => {
      warnCalls.push({ message, data });
    },
    infoCalls,
    warnCalls,
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a record payload');
  }
  return Object.fromEntries(Object.entries(value));
}

describe('SqliteTelemetryAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('emit (dual sink)', () => {
    it('persists llm_call to SQLite with flattened scope + duration_ms', () => {
      const db = freshDb();
      const logger = spyLogger();
      const adapter = new SqliteTelemetryAdapter(db, logger);

      const event: TelemetryEvent = {
        kind: 'llm_call',
        modelId: 'gpt-5',
        stream: true,
        durationMs: 1234,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        scope: { conversationId: 'conv-1', runId: 'run-1', turnId: 'turn-1' },
      };
      adapter.emit(event);

      const rows = db.prepare('SELECT * FROM engine_telemetry').all() as Array<
        Record<string, unknown>
      >;
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.event_kind).toBe('llm_call');
      expect(row.conversation_id).toBe('conv-1');
      expect(row.run_id).toBe('run-1');
      expect(row.turn_id).toBe('turn-1');
      expect(row.duration_ms).toBe(1234);
      expect(row.emitted_at).toBe(Date.parse('2026-04-22T10:00:00.000Z'));
      expect(JSON.parse(row.payload as string)).toEqual(event);

      db.close();
    });

    it('persists canonical usage and token ledger payload for llm_call audit', () => {
      const db = freshDb();
      const adapter = new SqliteTelemetryAdapter(db);

      adapter.emit({
        kind: 'llm_call',
        modelId: 'gpt-5',
        stream: false,
        durationMs: 300,
        canonicalUsage: {
          inputTokens: 90,
          outputTokens: 25,
          cacheReadTokens: 30,
          source: 'provider-response-usage',
          confidence: 'actual',
        },
        tokenLedgerEntry: {
          id: 'ledger-1',
          kind: 'llm-usage',
          runId: 'run-1',
          modelId: 'gpt-5',
          usage: {
            inputTokens: 90,
            outputTokens: 25,
            cacheReadTokens: 30,
            source: 'provider-response-usage',
            confidence: 'actual',
          },
        },
        scope: { conversationId: 'conv-1', runId: 'run-1' },
      });

      const row = readRecord(db.prepare('SELECT payload FROM engine_telemetry').get());
      const payloadText = row.payload;
      if (typeof payloadText !== 'string') {
        throw new Error('engine_telemetry.payload must be a JSON string');
      }
      const payload = readRecord(JSON.parse(payloadText));
      expect(payload.canonicalUsage).toEqual({
        inputTokens: 90,
        outputTokens: 25,
        cacheReadTokens: 30,
        source: 'provider-response-usage',
        confidence: 'actual',
      });
      expect(payload.tokenLedgerEntry).toMatchObject({
        id: 'ledger-1',
        kind: 'llm-usage',
      });

      db.close();
    });

    it('persists tool_call with errorCode in payload', () => {
      const db = freshDb();
      const adapter = new SqliteTelemetryAdapter(db);

      adapter.emit({
        kind: 'tool_call',
        toolName: 'web_search',
        durationMs: 500,
        ok: false,
        errorCode: 'TIMEOUT',
        scope: { conversationId: 'conv-1' },
      });

      const row = db.prepare('SELECT * FROM engine_telemetry').get() as Record<
        string,
        unknown
      >;
      expect(row.event_kind).toBe('tool_call');
      expect(row.duration_ms).toBe(500);
      const payload = JSON.parse(row.payload as string);
      expect(payload.toolName).toBe('web_search');
      expect(payload.ok).toBe(false);
      expect(payload.errorCode).toBe('TIMEOUT');

      db.close();
    });

    it('persists graph_node with node info in payload', () => {
      const db = freshDb();
      const adapter = new SqliteTelemetryAdapter(db);

      adapter.emit({
        kind: 'graph_node',
        nodeId: 'llm',
        durationMs: 12,
        scope: { conversationId: 'conv-1', stepId: 'step-3' },
      });

      const row = db.prepare('SELECT * FROM engine_telemetry').get() as Record<
        string,
        unknown
      >;
      expect(row.event_kind).toBe('graph_node');
      expect(row.step_id).toBe('step-3');
      expect(row.duration_ms).toBe(12);
      expect(JSON.parse(row.payload as string).nodeId).toBe('llm');

      db.close();
    });

    it('persists run_lifecycle (no duration_ms field)', () => {
      const db = freshDb();
      const adapter = new SqliteTelemetryAdapter(db);

      adapter.emit({
        kind: 'run_lifecycle',
        runId: 'run-7',
        phase: 'completed',
        stepsUsed: 6,
        maxSteps: 8,
        terminalReason: 'completed',
        scope: { conversationId: 'conv-1' },
      });

      const row = db.prepare('SELECT * FROM engine_telemetry').get() as Record<
        string,
        unknown
      >;
      expect(row.event_kind).toBe('run_lifecycle');
      expect(row.run_id).toBe('run-7');
      expect(row.duration_ms).toBeNull();
      expect(JSON.parse(row.payload as string)).toMatchObject({
        phase: 'completed',
        stepsUsed: 6,
        maxSteps: 8,
        terminalReason: 'completed',
      });

      db.close();
    });

    it('fans context_build and llm_call telemetry into token calibration collector', () => {
      const db = freshDb();
      const tokenCalibrationCollector = new LinnyaTokenCalibrationCollector({ now: () => 1234 });
      const adapter = new SqliteTelemetryAdapter(
        db,
        undefined,
        undefined,
        tokenCalibrationCollector,
      );

      adapter.emit({
        kind: 'context_build',
        modelId: route.modelId,
        tokenEstimate: {
          route,
          localEstimateTokens: 80,
          calibratedEstimateTokens: 120,
          finalTokens: 120,
          source: 'local-estimate',
          confidence: 'estimate',
        },
        scope: {
          conversationId: 'conv-1',
          runId: 'run-1',
          turnId: 'turn-1',
        },
      });
      adapter.emit({
        kind: 'llm_call',
        modelId: route.modelId,
        stream: false,
        durationMs: 300,
        canonicalUsage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 10,
          source: 'provider-response-usage',
          confidence: 'actual',
        },
        scope: {
          conversationId: 'conv-1',
          runId: 'run-1',
          turnId: 'turn-1',
        },
      });

      expect(tokenCalibrationCollector.getSamples(route)).toEqual([
        {
          route,
          localEstimateTokens: 80,
          actualInputTokens: 110,
          source: 'provider-response-usage',
          confidence: 'actual',
          observedAt: 1234,
          runId: 'run-1',
        },
      ]);

      db.close();
    });

    it('fans context_build component ledger into run cost collector', () => {
      const db = freshDb();
      const runCostCollector = new LinnyaRunCostCollector();
      const adapter = new SqliteTelemetryAdapter(
        db,
        undefined,
        runCostCollector,
      );

      adapter.emit({
        kind: 'context_build',
        modelId: route.modelId,
        tokenEstimate: {
          route,
          localEstimateTokens: 40,
          calibratedEstimateTokens: 50,
          finalTokens: 50,
          source: 'local-estimate',
          confidence: 'estimate',
        },
        tokenLedgerEntry: {
          id: 'context-ledger-1',
          kind: 'context-component',
          runId: 'run-1',
          turnId: 'turn-1',
          components: [
            {
              componentId: '0:user-1',
              kind: 'user',
              tokens: 50,
              source: 'local-estimate',
              confidence: 'estimate',
              kept: true,
            },
          ],
          totalTokens: 50,
        },
        scope: {
          conversationId: 'conv-1',
          runId: 'run-1',
          turnId: 'turn-1',
        },
      });

      expect(runCostCollector.snapshot('run-1').tokenUsage?.own).toMatchObject({
        contextTokens: 50,
        contextComponentCount: 1,
      });

      db.close();
    });

    it('writes a single-line log via logger.info on every emit', () => {
      const db = freshDb();
      const logger = spyLogger();
      const adapter = new SqliteTelemetryAdapter(db, logger);

      adapter.emit({
        kind: 'llm_call',
        modelId: 'gpt-5',
        stream: true,
        durationMs: 1234,
        scope: {
          conversationId: 'conv-abc',
          runId: 'child-run-1',
          parentRunId: 'parent-run-1',
        },
      });
      adapter.emit({
        kind: 'tool_call',
        toolName: 'search',
        durationMs: 89,
        ok: true,
        scope: { conversationId: 'conv-abc' },
      });

      expect(logger.infoCalls).toHaveLength(2);
      expect(logger.infoCalls[0]!.message).toContain('[telemetry] llm_call');
      expect(logger.infoCalls[0]!.message).toContain('duration_ms=1234');
      expect(logger.infoCalls[0]!.message).toContain('conv=conv-abc');
      expect(logger.infoCalls[0]!.message).toContain('run=child-run-1');
      expect(logger.infoCalls[0]!.message).toContain('parent=parent-run-1');
      expect(logger.infoCalls[0]!.message).toContain('model=gpt-5');
      expect(logger.infoCalls[1]!.message).toContain('[telemetry] tool_call');
      expect(logger.infoCalls[1]!.message).toContain('name=search');
      expect(logger.infoCalls[1]!.message).toContain('ok=true');

      db.close();
    });

    it('does not throw when SQLite write fails; logs warn instead', () => {
      const db = freshDb();
      db.close(); // 关掉 db，下次 prepare 必然失败

      const logger = spyLogger();
      const adapter = new SqliteTelemetryAdapter(db, logger);

      expect(() => {
        adapter.emit({
          kind: 'graph_node',
          nodeId: 'user',
          durationMs: 1,
          scope: { conversationId: 'conv-1' },
        });
      }).not.toThrow();

      expect(logger.warnCalls).toHaveLength(1);
      expect(logger.warnCalls[0]!.message).toContain('SQLite emit failed');
      // 即使写盘失败，logger.info 仍被调用（保证开发者至少看得到事件）
      expect(logger.infoCalls).toHaveLength(1);
    });
  });

  describe('execution audit projection', () => {
    it('只读取指定会话的执行审计安全白名单字段', async () => {
      const db = freshDb();
      const adapter = new SqliteTelemetryAdapter(db);
      adapter.emit({
        kind: 'llm_call',
        modelId: 'gpt-5',
        stream: true,
        durationMs: 30,
        canonicalUsage: {
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 80,
          source: 'provider-response-usage',
          confidence: 'actual',
          rawUsage: { secretProviderField: 'must-not-project' },
        },
        scope: { conversationId: 'conversation-1', runId: 'run-1' },
      });
      adapter.emit({
        kind: 'tool_call',
        toolName: 'slides_build',
        durationMs: 50,
        ok: false,
        errorCode: 'validation_error',
        scope: { conversationId: 'conversation-1', runId: 'run-1' },
      });
      adapter.emit({
        kind: 'tool_call',
        toolName: 'unrelated',
        durationMs: 1,
        ok: true,
        scope: { conversationId: 'conversation-2', runId: 'run-2' },
      });

      const records = await adapter.listByConversation('conversation-1');
      expect(records).toEqual([
        {
          kind: 'llm_call',
          modelId: 'gpt-5',
          durationMs: 30,
          emittedAt: Date.parse('2026-04-22T10:00:00.000Z'),
          runId: 'run-1',
          parentRunId: undefined,
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            cacheReadTokens: 80,
            confidence: 'actual',
          },
        },
        {
          kind: 'tool_call',
          toolName: 'slides_build',
          durationMs: 50,
          emittedAt: Date.parse('2026-04-22T10:00:00.000Z'),
          runId: 'run-1',
          parentRunId: undefined,
          ok: false,
          errorCode: 'validation_error',
        },
      ]);
      expect(JSON.stringify(records)).not.toContain('secretProviderField');
      db.close();
    });

    it('投影 context compaction 与 run 终态，但不泄漏摘要正文', async () => {
      const db = freshDb();
      const adapter = new SqliteTelemetryAdapter(db);
      adapter.emit({
        kind: 'context_compaction',
        modelId: 'gpt-5',
        durationMs: 900,
        compactionIndex: 2,
        maxCompactionsPerRun: 12,
        generationAttempted: true,
        triggerRatio: 0.8,
        targetRatio: 0.5,
        beforeTokens: 8_500,
        inputBudgetTokens: 10_000,
        compactionInputTokens: 6_000,
        afterTokens: 4_800,
        replacedMessageCount: 20,
        replacedToolGroupCount: 5,
        keptToolGroupCount: 2,
        summaryOutputTokens: 600,
        compressionRatio: 0.1,
        canonicalUsage: {
          inputTokens: 6_100,
          outputTokens: 580,
          cacheReadTokens: 5_500,
          source: 'provider-response-usage',
          confidence: 'actual',
          rawUsage: { checkpointText: 'must-not-project' },
        },
        outcome: 'completed',
        forcedPhaseRecovery: false,
        scope: {
          conversationId: 'conversation-1',
          runId: 'child-1',
          parentRunId: 'root-1',
        },
      });
      adapter.emit({
        kind: 'context_compaction',
        modelId: 'gpt-5',
        durationMs: 0,
        compactionIndex: 3,
        maxCompactionsPerRun: 12,
        generationAttempted: false,
        triggerRatio: 0.8,
        targetRatio: 0.5,
        beforeTokens: 10_001,
        inputBudgetTokens: 10_000,
        replacedMessageCount: 0,
        replacedToolGroupCount: 0,
        keptToolGroupCount: 2,
        outcome: 'insufficient',
        forcedPhaseRecovery: false,
        failureReason: 'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE',
        scope: {
          conversationId: 'conversation-1',
          runId: 'child-1',
          parentRunId: 'root-1',
        },
      });
      adapter.emit({
        kind: 'run_lifecycle',
        runId: 'child-1',
        phase: 'completed',
        stepsUsed: 58,
        maxSteps: 60,
        terminalReason: 'completed',
        scope: {
          conversationId: 'conversation-1',
          runId: 'child-1',
          parentRunId: 'root-1',
        },
      });

      const records = await adapter.listByConversation('conversation-1');
      expect(records).toHaveLength(3);
      expect(records[0]).toMatchObject({
        kind: 'context_compaction',
        runId: 'child-1',
        parentRunId: 'root-1',
        compactionIndex: 2,
        maxCompactionsPerRun: 12,
        generationAttempted: true,
        beforeTokens: 8_500,
        afterTokens: 4_800,
        compressionRatio: 0.1,
        usage: {
          inputTokens: 6_100,
          outputTokens: 580,
          cacheReadTokens: 5_500,
          confidence: 'actual',
        },
      });
      expect(records[1]).toMatchObject({
        kind: 'context_compaction',
        generationAttempted: false,
        outcome: 'insufficient',
        usage: undefined,
      });
      expect(records[2]).toMatchObject({
        kind: 'run_lifecycle',
        stepsUsed: 58,
        maxSteps: 60,
        terminalReason: 'completed',
      });
      expect(JSON.stringify(records)).not.toContain('checkpointText');
      db.close();
    });
  });

  describe('flush', () => {
    it('is a no-op (better-sqlite3 is synchronous, no buffering)', async () => {
      const db = freshDb();
      const adapter = new SqliteTelemetryAdapter(db);
      await expect(adapter.flush()).resolves.toBeUndefined();
      db.close();
    });
  });

  describe('purgeStale (host-side GC)', () => {
    it('deletes rows older than the cutoff and returns the count', () => {
      const db = freshDb();
      const adapter = new SqliteTelemetryAdapter(db);

      vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
      adapter.emit({
        kind: 'graph_node',
        nodeId: 'a',
        durationMs: 1,
        scope: { conversationId: 'c' },
      });
      adapter.emit({
        kind: 'graph_node',
        nodeId: 'b',
        durationMs: 1,
        scope: { conversationId: 'c' },
      });

      vi.setSystemTime(new Date('2026-04-21T00:00:00.000Z'));
      adapter.emit({
        kind: 'graph_node',
        nodeId: 'c',
        durationMs: 1,
        scope: { conversationId: 'c' },
      });

      const removed = adapter.purgeStale({
        olderThanMs: 7 * 24 * 60 * 60 * 1000,
        now: Date.parse('2026-04-22T00:00:00.000Z'),
      });

      expect(removed).toBe(2);
      const remaining = db
        .prepare('SELECT payload FROM engine_telemetry')
        .all() as Array<{ payload: string }>;
      expect(remaining).toHaveLength(1);
      expect(JSON.parse(remaining[0]!.payload).nodeId).toBe('c');

      db.close();
    });

    it('returns 0 when nothing matches', () => {
      const db = freshDb();
      const adapter = new SqliteTelemetryAdapter(db);

      vi.setSystemTime(new Date('2026-04-21T00:00:00.000Z'));
      adapter.emit({
        kind: 'graph_node',
        nodeId: 'a',
        durationMs: 1,
        scope: {},
      });

      const removed = adapter.purgeStale({
        olderThanMs: 7 * 24 * 60 * 60 * 1000,
        now: Date.parse('2026-04-22T00:00:00.000Z'),
      });

      expect(removed).toBe(0);
      db.close();
    });
  });
});
