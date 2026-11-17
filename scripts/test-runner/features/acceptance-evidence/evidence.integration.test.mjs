import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { createEvidence } from './createEvidence.mjs';

test('真实 Vitest 报告区分业务断言失败、编译错误、跳过与成功', () => {
  const root = mkdtempSync(join(tmpdir(), 'linnya-evidence-test-'));
  const require = createRequire(import.meta.url);
  const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const reporter = fileURLToPath(new URL('./vitestReporter.mjs', import.meta.url));
  try {
    const config = join(root, 'vitest.config.mjs');
    writeFileSync(config, "export default {test:{globals:true,include:['case.test.mjs']}};\n");
    const examples = [
      ["test('persisted',()=>expect(1).toBe(2))", 'failed', 'assertion'],
      ["test('persisted',()=>{throw new Error('service failed')})", 'failed', 'error'],
      ["test.skip('persisted',()=>expect(1).toBe(2))", 'skipped'],
      ["test('persisted',()=>expect(2).toBe(2))", 'passed'],
      ['export const value = ;', 'compile'],
    ];
    for (const [index, [code, state, kind]] of examples.entries()) {
      writeFileSync(join(root, 'case.test.mjs'), code);
      const output = join(root, `evidence-${index}`);
      try {
        execFileSync(process.execPath, [vitest, 'run', '--root', root, '--config', config, '--reporter', reporter], {
          env: { ...process.env, ACCEPTANCE_EVIDENCE_DIR: output }, stdio: 'pipe', timeout: 30_000,
        });
        assert.ok(['passed', 'skipped'].includes(state));
      } catch (error) {
        if (!('status' in error)) throw error;
        assert.equal(error.status, 1);
        assert.ok(['failed', 'compile'].includes(state));
      }
      const report = JSON.parse(readFileSync(join(output, 'evidence.json'), 'utf8'));
      if (state === 'compile') {
        assert.equal(report.checks.length, 0);
        assert.ok(report.errors.length > 0);
      } else {
        assert.equal(report.checks[0].name, 'case.test.mjs > persisted');
        assert.equal(report.checks[0].status, state);
        assert.equal(report.checks[0].failure?.kind, kind);
        assert.deepEqual(report.errors, []);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 40_000);

test('场景清理实例后附件仍保留，失败步骤不会生成成功记录', async () => {
  const root = mkdtempSync(join(tmpdir(), 'linnya-evidence-artifact-'));
  try {
    const instance = join(root, 'instance');
    mkdirSync(instance);
    writeFileSync(join(instance, 'shot.png'), 'saved image bytes');
    const evidence = createEvidence('example', { root, files: ['case.mjs'], directory: join(root, 'out') });
    evidence.artifact(join(instance, 'shot.png'));
    rmSync(instance, { recursive: true });
    await evidence.check('保存后重读', () => assert.equal(2, 2));
    await assert.rejects(evidence.check('只改变目标内容', () => assert.equal(2, 1)), { code: 'ERR_ASSERTION' });
    const report = evidence.finish();
    assert.equal(readFileSync(join(report.directory, report.artifacts[0].path), 'utf8'), 'saved image bytes');
    assert.deepEqual(report.checks.map(check => check.status), ['passed', 'failed']);
    assert.equal(report.checks[1].failure.kind, 'assertion');
    assert.throws(() => createEvidence('example', { directory: report.directory }), /已经使用/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
