import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';
import { createVitest } from 'vitest/node';

it('discovers source tests and filters them without collecting frozen or generated copies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-test-discovery-'));
  const sourceTests = [
    'src/domains/example/flow.test.ts',
    'apps/renderer/app/fixtures/example.spec.ts',
    'packages/example/tests/contract.test.mjs',
    'packages/plugins/example/src/feature.test.ts',
    'scripts/e2e/example/fixtures/contract.test.ts',
  ];
  const generatedTests = [
    '_dev_data/frozen-source/src/domains/example/flow.test.ts',
    '.linnya-development-data-retired/old/src/domains/example/flow.test.ts',
    'benchmark-results/runs/example/src/domains/example/flow.test.ts',
    'extraResources/plugins/example/src/feature.test.ts',
    'unregistered-copy/src/domains/example/flow.test.ts',
    'packages/example/node_modules/dependency/contract.test.ts',
    'packages/example/.git/contract.test.ts',
    ...[
      'dist', 'dist-ssr', 'dist_build', 'dist_electron', 'dist_release',
      'coverage', '.coverage', '.nyc_output', '_dev_data',
      '.linnya-development-data-retired', 'storage', 'logs', '.turbo',
      'temp', 'temp_tsup', 'temp_ts_build', '.tmp_discovery',
    ].map(directory => `packages/example/${directory}/src/feature.test.ts`),
    'packages/parser-wasm/pkg/generated.test.ts',
    'packages/parser-wasm/pkg-node/generated.test.ts',
    'packages/parser-wasm/target/generated.test.ts',
    'src/infra/adapters/command-runtime/windows/native/target/generated.test.ts',
    'src/infra/adapters/command-runtime/plugin-cli-client/native/target/generated.test.ts',
  ];

  try {
    await Promise.all([...sourceTests, ...generatedTests].map(async file => {
      const absolutePath = path.join(root, file);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      // 只验证发现阶段；冻结目录里的测试代码不能被求值或执行。
      await writeFile(absolutePath, "throw new Error('Discovery must not execute test modules');\n");
    }));
    const vitest = await createVitest('test', {
      root,
      config: path.resolve(import.meta.dirname, '../../../vitest.config.ts'),
      watch: false,
    });
    try {
      const discovered = await vitest.globTestSpecifications();
      expect(discovered.map(test => path.relative(root, test.moduleId).split(path.sep).join('/')).sort())
        .toEqual([...sourceTests].sort());

      // 完整路径和短路径过滤都只能命中源码，不能重新接纳同名冻结副本。
      const selected = await vitest.globTestSpecifications([sourceTests[0], sourceTests[1]]);
      expect(selected.map(test => path.relative(root, test.moduleId).split(path.sep).join('/')).sort())
        .toEqual(sourceTests.slice(0, 2).sort());
      const shortFilter = await vitest.globTestSpecifications(['flow.test.ts']);
      expect(shortFilter.map(test => path.relative(root, test.moduleId).split(path.sep).join('/')))
        .toEqual([sourceTests[0]]);
      const frozen = await vitest.globTestSpecifications(['_dev_data']);
      expect(frozen).toEqual([]);
    } finally {
      await vitest.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
