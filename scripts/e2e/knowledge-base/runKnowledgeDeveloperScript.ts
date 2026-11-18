import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 开发诊断显式装配源码 SDK；不改变产品 loader，也不进入插件发行包。 */
export async function runKnowledgeDeveloperScript(entry: string): Promise<void> {
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const developmentRoot = path.join(repositoryRoot, 'packages/plugins/knowledge/dev');
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      require.resolve('tsx/cli'),
      '--tsconfig',
      path.join(developmentRoot, 'tsconfig.json'),
      path.join(developmentRoot, entry),
      ...process.argv.slice(2),
    ],
    { cwd: repositoryRoot, env: process.env, stdio: 'inherit' }
  );
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}
