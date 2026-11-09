import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { repoRoot } from '../definitions/probeContract.mjs';
import { launchOptions, parseProbeArgs } from '../functions/parseProbeArgs.mjs';
import { instanceRoot } from '../infrastructure/instanceStore.mjs';

test('非法实例路径和尺寸在启动任何进程前被拒绝', () => {
  assert.throws(() => instanceRoot('../_dev_data'), { code: 'USAGE' });
  assert.throws(() => launchOptions(parseProbeArgs(['up', '--size', '100x50']).values), { code: 'USAGE' });
  assert.throws(() => parseProbeArgs(['up', '--workdir', 'other']), { code: 'USAGE' });
});

test('产品源码与安装包入口不引用开发探针', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', 'apps', 'packages'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  for (const file of tracked.split('\0').filter(path => /\.(?:[cm]?js|[cm]?ts|tsx|vue)$/.test(path))) {
    assert.doesNotMatch(readFileSync(join(repoRoot, file), 'utf8'), /scripts\/development\/features\/desktop-probe/, file);
  }
  const { build } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  for (const file of build.files) {
    const source = typeof file === 'string' ? file : file.from;
    assert.doesNotMatch(source, /^(?:\*\*|scripts)(?:\/|$)/);
  }
});
