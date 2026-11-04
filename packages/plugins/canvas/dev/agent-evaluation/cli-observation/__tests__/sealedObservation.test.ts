import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSealedCanvasCliObservation } from '../readSealedCanvasCliObservation';
import { createSealedObservationFixture } from './sealedObservation.fixture';

it('实际writer封存链经SHA/编译映射/已核源原件接纳，prepare结果仍无Host身份', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'canvas-cli-seal-')), f = createSealedObservationFixture(root);
  try {
    f.record({ argv: ['apply', 'workspace:/T13.canvas', '--request-id', 'same-id', '--dry-run'], response: { error: { code: 'invalid', message: 'fixture' } }, at: 800, until: 801, prepareOnly: true, exitCode: 8 });
    f.record({ argv: ['apply', 'workspace:/T13.canvas', '--request-id=same-id'], response: { status: 'committed', replayed: false, computation: null }, at: 950, until: 1010 });
    f.seal(); const result = await readSealedCanvasCliObservation(f);
    expect(result.producerContract).toBe('source61-fresh-committed-null-iff-no-arrange');
    expect(result.invocations).toHaveLength(2); expect(result.invocations[0]).toMatchObject({ stage: 'prepare', identity: null, startedAt: null });
    expect(result.invocations[1]).toMatchObject({ origin: 'backend-cli-observation', invocationId: 'cli-2', identity: { conversationId: 'conv', agentRunId: 'run', projectId: 'project' },
      input: { requestId: { state: 'explicit', value: 'same-id' }, dryRun: { state: 'absent', value: false } } });
    const event = path.join(f.directory, '000004.json'); writeFileSync(event, readFileSync(event, 'utf8') + ' ');
    await expect(readSealedCanvasCliObservation(f)).rejects.toThrow('hash_or_size');
  } finally { f.restoreClock(); rmSync(root, { recursive: true, force: true }); }
});

it('无seal/在途partial、损坏compiled payload或producer原件均拒证，不接受仅source字符串', async () => {
  for (const fault of ['missing-seal', 'partial', 'compiled', 'producer'] as const) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'canvas-cli-seal-bad-')), f = createSealedObservationFixture(root);
    try {
      if (fault === 'partial') f.observation.start({ argv: ['help'], conversationRoot: '/conversation', invocationId: 'pending' });
      if (fault !== 'missing-seal') f.seal(); else f.restoreClock();
      if (fault === 'compiled') writeFileSync(path.join(f.artifact, 'dist/backend/index.production.cjs'), 'different compiled bytes');
      if (fault === 'producer') writeFileSync(path.join(f.sources, 'src/backend/orchestration/executeCanvasCliWrite.ts'), 'different producer bytes');
      await expect(readSealedCanvasCliObservation(f)).rejects.toThrow();
    } finally { f.restoreClock(); rmSync(root, { recursive: true, force: true }); }
  }
});
