import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';
import {
  createLinnyaAuditRuntime,
  flushLinnyaAudit,
  recordAfterContextManager,
  resetLlmRunAuditForTest,
  resolveAuditLevel,
  runWithLLMAuditContext,
} from '..';

const baseEnvelope = (action: string) =>
  AuditEnvelope.parse({
    envelopeId: `audit-test-${action.replace(/\./g, '-')}`,
    runId: 'run-audit-runtime-test',
    ts: 1,
    actor: { kind: 'host', name: 'audit-test' },
    action,
    scope: {
      conversationId: 'conversation-audit-runtime-test',
      runId: 'run-audit-runtime-test',
    },
  });

const tempDirectories: string[] = [];

afterEach(async () => {
  resetLlmRunAuditForTest();
  await Promise.all(
    tempDirectories.splice(0).map(directory => fsp.rm(directory, { recursive: true, force: true }))
  );
});

describe('unified audit runtime', () => {
  it('defaults to standard and only allows debug in development', () => {
    expect(resolveAuditLevel({})).toBe('standard');
    expect(resolveAuditLevel({ LINNYA_AUDIT_LEVEL: 'minimal' })).toBe('minimal');
    expect(resolveAuditLevel({ LINNYA_AUDIT_LEVEL: 'unknown' })).toBe('standard');
    expect(resolveAuditLevel({ LINNYA_AUDIT_LEVEL: 'debug' })).toBe('standard');
    expect(
      resolveAuditLevel({
        LINNYA_AUDIT_LEVEL: 'debug',
        LINNYA_DEV_MODE: 'true',
      })
    ).toBe('debug');
  });

  it('filters minimal actions before they reach the only sink', () => {
    const envelopes: AuditEnvelope[] = [];
    const sink: AuditPort = {
      emit: envelope => {
        envelopes.push(envelope);
      },
    };
    const runtime = createLinnyaAuditRuntime({ sink, level: 'minimal' });

    runtime.auditPort.emit(baseEnvelope('model.select'));
    runtime.auditPort.emit(baseEnvelope('run.cancel'));
    runtime.auditPort.emit(baseEnvelope('command.execution.started'));

    expect(envelopes.map(envelope => envelope.action)).toEqual([
      'run.cancel',
      'command.execution.started',
    ]);
  });

  it('通过同一入口把 LLM debug evidence 路由到有界文件，不写入 durable sink', async () => {
    const envelopes: AuditEnvelope[] = [];
    const directoryPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-audit-runtime-'));
    tempDirectories.push(directoryPath);
    const sink: AuditPort = {
      emit: envelope => {
        envelopes.push(envelope);
      },
    };
    createLinnyaAuditRuntime({ sink, level: 'debug', debugEvidenceDirectoryPath: directoryPath });

    await runWithLLMAuditContext(
      {
        conversationId: 'conversation-audit-runtime-test',
        runId: 'run-audit-runtime-test',
        traceId: 'trace-audit-runtime-test',
      },
      async () => {
        recordAfterContextManager({
          contextMessages: [{ role: 'user', content: 'debug evidence' }],
          llmMessages: [{ role: 'user', content: 'debug evidence' }],
          toolNames: ['read_file'],
        });
        await flushLinnyaAudit();
      }
    );

    expect(envelopes).toHaveLength(0);
    const debugFile = path.join(
      directoryPath,
      'conversation-audit-runtime-test',
      'run-audit-runtime-test.jsonl'
    );
    const debugEnvelope = AuditEnvelope.parse(
      JSON.parse((await fsp.readFile(debugFile, 'utf8')).trim())
    );
    expect(debugEnvelope.action).toBe('llm.context.after');
    expect(debugEnvelope.scope?.conversationId).toBe('conversation-audit-runtime-test');
    expect(debugEnvelope.evidence?.[0]?.kind).toBe('llm_audit');
  });
});
