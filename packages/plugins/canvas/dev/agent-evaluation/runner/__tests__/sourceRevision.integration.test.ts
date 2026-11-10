import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { verifyEvaluationSourceRevision } from '../adapters/verifySourceRevision';
const execute = promisify(execFile);
it('allows only the bridge HTML marker while freezing the exact commit and all other source files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'canvas-runner-revision-')),
    original = '<body>App</body>\n';
  const git = (args: readonly string[]) => execute('git', [...args], { cwd: directory });
  try {
    await git(['init', '--quiet']);
    await writeFile(path.join(directory, 'index.html'), original);
    await git(['add', 'index.html']);
    await git([
      '-c',
      'user.name=Runner test',
      '-c',
      'user.email=runner@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ]);
    const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    await verifyEvaluationSourceRevision(directory, revision);
    await writeFile(
      path.join(directory, 'index.html'),
      '<body>App<script type="module" data-canvas-evaluation-bridge="a1" src="/packages/plugins/canvas/dev/agent-evaluation/rendererEntry.ts?port=1&nonce=test"></script>\n</body>\n'
    );
    await verifyEvaluationSourceRevision(directory, revision);
    await writeFile(path.join(directory, 'production.ts'), 'export const changed = true;');
    await expect(verifyEvaluationSourceRevision(directory, revision)).rejects.toThrow('changes');
    await expect(verifyEvaluationSourceRevision(directory, '0'.repeat(40))).rejects.toThrow(
      'revision changed'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
