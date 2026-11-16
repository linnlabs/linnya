import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const guard = resolve('scripts/guards/tsc-baseline-guard.mjs');
it('基线保留正常诊断；编译器崩溃、信号终止与无诊断失败均不得收紧基线', () => {
  const root = mkdtempSync(join(tmpdir(), 'typecheck-process-'));
  try {
    mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
    mkdirSync(join(root, '.baseline'));
    const baseline = 'Total errors: 1\n';
    for (const name of ['typescript-errors', 'renderer-typescript-errors']) writeFileSync(join(root, `.baseline/${name}.txt`), baseline);
    const compiler = (name: string, code: string) => {
      const path = join(root, 'node_modules/.bin', name);
      writeFileSync(path, `#!/usr/bin/env node\n${code}\n`); chmodSync(path, 0o755);
    };
    const diagnostics = "console.log('src/example.ts(1,1): error TS2322: mismatch'); process.exit(2)";
    compiler('tsc', diagnostics); compiler('vue-tsc', diagnostics);
    execFileSync(process.execPath, [guard], { cwd: root });
    for (const code of ["process.exit(7)", "process.exit(1)", "process.kill(process.pid, 'SIGTERM')"]) {
      compiler('tsc', code);
      const result = spawnSync(process.execPath, [guard, '--update-baseline'], { cwd: root, encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('未正常完成');
      expect(readFileSync(join(root, '.baseline/typescript-errors.txt'), 'utf8')).toBe(baseline);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
