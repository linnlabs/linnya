import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const execute = promisify(execFile);
/** 只允许桥自己的临时script；任何真正源码变更必须开始新批，不能混用成功样本。 */
export async function verifyEvaluationSourceRevision(
  repositoryRoot: string,
  sourceRevision: string
): Promise<void> {
  const head = await execute('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
  if (head.stdout.trim() !== sourceRevision)
    throw new Error('Source revision changed; start a new evaluation batch');
  const status = await execute('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: repositoryRoot,
  });
  const changed = status.stdout.split('\n').filter(Boolean);
  if (!changed.length) return;
  if (changed.length !== 1 || changed[0] !== ' M index.html')
    throw new Error('Source checkout has changes; freeze implementation before evaluation');
  const original = await execute('git', ['show', 'HEAD:index.html'], { cwd: repositoryRoot });
  const current = await readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  const stripped = current.replace(
    /<script type="module" data-canvas-evaluation-bridge="[a-f0-9-]+" src="\/packages\/plugins\/canvas\/dev\/agent-evaluation\/rendererEntry\.ts\?[^"\n]+"><\/script>\n/g,
    ''
  );
  if (stripped !== original.stdout)
    throw new Error('index.html contains changes beyond the evaluation bridge');
}
