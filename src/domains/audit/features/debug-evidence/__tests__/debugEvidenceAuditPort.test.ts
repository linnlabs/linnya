import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createDebugEvidenceAuditPort } from '..';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(directory => fsp.rm(directory, { recursive: true, force: true }))
  );
});

function envelope(runId: string, sequence: number, payload = 'debug'): AuditEnvelope {
  return AuditEnvelope.parse({
    envelopeId: `debug-evidence-${runId}-${sequence}`,
    runId,
    ts: sequence,
    actor: { kind: 'host', name: 'debug-evidence-test' },
    action: 'llm.context.after',
    evidence: [{ kind: 'llm_audit', metadata: { payload } }],
    scope: { conversationId: 'conversation-debug-evidence', runId },
  });
}

async function tempDirectory(): Promise<string> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-debug-evidence-'));
  tempDirectories.push(directory);
  return directory;
}

describe('debug evidence audit port', () => {
  it('按 run 写 JSONL，并在达到单 run 上限后停止增长', async () => {
    const directoryPath = await tempDirectory();
    const first = `${JSON.stringify(envelope('run-bounded', 1, 'x'.repeat(80)))}\n`;
    const port = createDebugEvidenceAuditPort({
      directoryPath,
      maxRunFileBytes: Buffer.byteLength(first, 'utf8') + 8,
      maxDirectoryBytes: 16 * 1024,
    });

    await port.emit(envelope('run-bounded', 1, 'x'.repeat(80)));
    await port.emit(envelope('run-bounded', 2, 'x'.repeat(80)));
    await port.flush?.();

    const filePath = path.join(directoryPath, 'conversation-debug-evidence', 'run-bounded.jsonl');
    const lines = (await fsp.readFile(filePath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const [line] = lines;
    if (!line) throw new Error('expected one debug evidence line');
    expect(AuditEnvelope.parse(JSON.parse(line)).envelopeId).toBe('debug-evidence-run-bounded-1');
  });

  it('首次写入时删除超过 TTL 的旧诊断文件', async () => {
    const directoryPath = await tempDirectory();
    const oldDirectory = path.join(directoryPath, 'old-conversation');
    const oldFile = path.join(oldDirectory, 'old-run.jsonl');
    await fsp.mkdir(oldDirectory, { recursive: true });
    await fsp.writeFile(oldFile, '{}\n');
    await fsp.utimes(oldFile, new Date(1_000), new Date(1_000));

    const port = createDebugEvidenceAuditPort({
      directoryPath,
      now: () => 20_000,
      retentionMs: 10_000,
    });
    await port.emit(envelope('run-current', 1));
    await port.flush?.();

    await expect(fsp.stat(oldFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fsp.stat(path.join(directoryPath, 'conversation-debug-evidence', 'run-current.jsonl'))
    ).resolves.toBeDefined();
  });
});
