import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditEnvelope } from '../../../contracts';
import type { AuditPort } from '../../../ports';
import { MemoryEventStore } from '../../graph-engine/event-store/memoryEventStore';
import {
  AuditEnvelopePersistenceError,
  createCompositeAudit,
  createConsoleAudit,
  createEventStoreAudit,
  createFileAudit,
  noopAudit,
} from '../index';
import { RunIdSchema } from '../../../contracts';

const envelope: AuditEnvelope = {
  envelopeId: 'audit-1',
  runId: RunIdSchema.parse('run-1'),
  ts: 1000,
  actor: { kind: 'host' },
  action: 'run.cancel',
  decision: { outcome: 'cancelled', reason: '用户取消' },
  scope: {
    conversationId: 'conv-1',
    runId: RunIdSchema.parse('run-1'),
    turnId: 'turn-1',
  },
};

describe('audit ports', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('noopAudit accepts envelopes without side effects', async () => {
    await expect(Promise.resolve(noopAudit.emit(envelope))).resolves.toBeUndefined();
  });

  it('consoleAudit writes the envelope to the configured sink', () => {
    const info = vi.fn();
    const audit = createConsoleAudit({ sink: { info } });

    audit.emit(envelope);

    expect(info).toHaveBeenCalledWith('[linnkit:audit]', envelope);
  });

  it('fileAudit appends JSONL envelopes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'linnkit-audit-'));
    const filePath = join(tempDir, 'audit.jsonl');
    const audit = createFileAudit({ filePath });

    await audit.emit(envelope);
    await audit.emit({ ...envelope, envelopeId: 'audit-2' });

    const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ envelopeId: 'audit-1' });
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ envelopeId: 'audit-2' });
  });

  it('eventStoreAudit persists hidden audit_envelope runtime event', async () => {
    const eventStore = new MemoryEventStore();
    const audit = createEventStoreAudit({ eventStore });

    await audit.emit(envelope);

    const persisted = await eventStore.range('conv-1');
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.event.run_id).toBe('run-1');
    expect(persisted[0]?.event).toMatchObject({
      type: 'audit_envelope',
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      run_id: 'run-1',
      lane: 'auxiliary',
      visibility: 'none',
      envelope: {
        envelopeId: 'audit-1',
        action: 'run.cancel',
      },
    });
  });

  it('eventStoreAudit requires scope.conversationId', async () => {
    const eventStore = new MemoryEventStore();
    const audit = createEventStoreAudit({ eventStore });

    await expect(
      audit.emit({
        ...envelope,
        envelopeId: 'audit-no-conv',
        scope: { runId: RunIdSchema.parse('run-1') },
      })
    ).rejects.toBeInstanceOf(AuditEnvelopePersistenceError);
  });

  it('compositeAudit emits to every sink in order', async () => {
    const first = { emit: vi.fn<AuditPort['emit']>() };
    const second = { emit: vi.fn<AuditPort['emit']>() };
    const audit = createCompositeAudit({ ports: [first, second] });

    await audit.emit(envelope);

    expect(first.emit).toHaveBeenCalledWith(envelope);
    expect(second.emit).toHaveBeenCalledWith(envelope);
  });
});
