import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('reuses only a completed schemas build in its own checkout and verifies the runtime on every use', () => {
  const temporary = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'schemas-runtime-')));
  try {
    const checkout = path.join(temporary, 'checkout');
    const pkg = path.join(checkout, 'packages/schemas');
    const scripts = path.join(pkg, 'scripts');
    mkdirSync(scripts, { recursive: true });
    // 小包也走正式的 pnpm 构建入口。让 build 到最后的导入校验才失败，检验半成品的处理。
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
      name: 'schemas-runtime-fixture', private: true, scripts: { build: 'node build.cjs && node scripts/verify-runtime-exports.cjs' },
    }));
    writeFileSync(path.join(pkg, 'build.cjs'), "require('node:fs').copyFileSync('source.cjs', 'output.cjs')");
    writeFileSync(path.join(scripts, 'verify-runtime-exports.cjs'), "require('../output.cjs')");
    const source = path.join(pkg, 'source.cjs');
    const output = path.join(pkg, 'output.cjs');
    const entry = fileURLToPath(new URL('../../../../scripts/build/orchestration/prepareWorkspaceRuntime.mjs', import.meta.url));
    const prepare = scope => spawnSync(process.execPath, [entry, 'scripts/verify-runtime-exports.cjs'], {
      cwd: pkg, env: { ...process.env, LINNYA_CI_ARTIFACT_CHECKOUT: scope }, encoding: 'utf8',
    }).status;

    writeFileSync(source, "throw new Error('incomplete runtime')");
    expect(prepare(checkout)).not.toBe(0);
    expect(existsSync(output)).toBe(true);
    writeFileSync(source, 'module.exports = true');
    expect(prepare(checkout)).toBe(0);
    rmSync(source);
    expect(prepare(checkout)).toBe(0);
    rmSync(output);
    expect(prepare(checkout)).not.toBe(0);
    writeFileSync(source, 'module.exports = true');
    expect(prepare('')).toBe(0);
    rmSync(output);
    expect(prepare(path.join(temporary, 'other-checkout'))).toBe(0);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
