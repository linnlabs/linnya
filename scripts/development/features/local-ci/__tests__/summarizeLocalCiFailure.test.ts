import { describe, expect, it } from 'vitest';
import { NETWORK_FAILURE_MARKER } from '../../../../build/functions/transientNetworkFailure.cjs';
import { LOCAL_CI_FAILURE_DIGEST_LIMITS as LIMITS } from '../definitions/localCiFailureDigest';
import { formatLocalCiFailureDigest, summarizeLocalCiFailure } from '../functions/summarizeLocalCiFailure';

// vitest 4.1 在 CI=true 下的真实输出（取自一次实际运行，路径已缩短）。前半段是测试自己打印的错误日志，
// 其中有一行看起来像失败的噪声；失败段落在全部用例跑完后才输出。
const VITEST_OUTPUT = `
 RUN  v4.1.12 /checkout

stderr | sub/a.test.mjs > 分组 > 相等
噪声日志 ERROR something
 FAIL  这一行是测试自己打印的，不在失败段落里

 ❯ b.test.mjs (0 test)
 ❯ sub/a.test.mjs (3 tests | 2 failed) 306ms
     × 相等 3ms
     × 超时 302ms

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  b.test.mjs [ b.test.mjs ]
Error: Cannot find module './missing-module.mjs' imported from /checkout/b.test.mjs
 ❯ b.test.mjs:1:1
      1| import './missing-module.mjs';
       | ^
      2| import { it } from 'vitest';

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sub/a.test.mjs > 分组 > 相等
AssertionError: expected 1 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 1

 ❯ sub/a.test.mjs:3:69
      1| import { describe, it, expect } from 'vitest';
      3|   it('相等', () => { console.error('噪声日志 ERROR something'); expect(1).to…
       |                                                                     ^

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  sub/a.test.mjs > 分组 > 超时
Error: Test timed out in 300ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ sub/a.test.mjs:4:5
      4|   it('超时', async () => { await new Promise(r => setTimeout(r, 1000)); …
       |     ^

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


 Test Files  2 failed | 1 passed (3)
      Tests  2 failed | 2 passed (4)
   Start at  00:03:45
   Duration  389ms (transform 16ms, setup 0ms, import 24ms, tests 307ms, environment 0ms)

[exit 1]
`;

describe('失败摘要', () => {
  it('只从失败段落取用例、断言消息和位置，不被测试自己打印的错误日志带偏', () => {
    const digest = summarizeLocalCiFailure(VITEST_OUTPUT, 'test');

    expect(digest.kind).toBe('test');
    expect(digest.networkFailure).toBe(false);
    expect(digest.failedTestCount).toBe(3);
    expect(digest.failedTests).toEqual([
      {
        file: 'b.test.mjs',
        test: '',
        message: ["Error: Cannot find module './missing-module.mjs' imported from /checkout/b.test.mjs"],
        location: 'b.test.mjs:1:1',
      },
      {
        file: 'sub/a.test.mjs',
        test: '分组 > 相等',
        message: ['AssertionError: expected 1 to be 2 // Object.is equality', '- Expected', '+ Received', '- 2'],
        location: 'sub/a.test.mjs:3:69',
      },
      {
        file: 'sub/a.test.mjs',
        test: '分组 > 超时',
        message: [
          'Error: Test timed out in 300ms.',
          'If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".',
        ],
        location: 'sub/a.test.mjs:4:5',
      },
    ]);
    expect(digest.failedTestFiles).toEqual(['b.test.mjs', 'sub/a.test.mjs']);
    expect(digest.tail.at(-1)).toBe('[exit 1]');
    expect(formatLocalCiFailureDigest(digest)).toContain('      AssertionError: expected 1 to be 2 // Object.is equality');
  });

  it('多个用例报同一个错时共用一段报错', () => {
    const digest = summarizeLocalCiFailure(
      [
        '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯',
        '',
        ' FAIL  sub/a.test.mjs > 一',
        ' FAIL  sub/a.test.mjs > 二',
        'Error: 共享的错误',
        ' ❯ sub/a.test.mjs:2:16',
        '⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯',
      ].join('\n'),
      'test'
    );
    expect(digest.failedTests.map(failure => [failure.test, failure.message, failure.location])).toEqual([
      ['一', ['Error: 共享的错误'], 'sub/a.test.mjs:2:16'],
      ['二', ['Error: 共享的错误'], 'sub/a.test.mjs:2:16'],
    ]);
  });

  it('构建脚本重试用尽留下的标记行使这次失败标为网络原因；不是测试步骤时给日志末尾', () => {
    const log = [
      '$ pnpm run release:lock:production:audit',
      `${NETWORK_FAILURE_MARKER} npm 审计生产依赖：重试 2 次后仍失败（https://registry.npmjs.org/-/npm/v1/security/advisories/bulk：connect ECONNREFUSED 127.0.0.1:9）`,
      '[production-package-lock] npm 审计生产依赖：网络失败，重试 2 次后仍失败',
      '[exit 1]',
    ].join('\n');
    const digest = summarizeLocalCiFailure(log, 'static');

    expect(digest.networkFailure).toBe(true);
    expect(digest.failedTestCount).toBe(0);
    const printed = formatLocalCiFailureDigest(digest);
    expect(printed[0]).toMatch(/^网络失败/u);
    expect(printed).toContain('[exit 1]');
  });

  it('很长的日志和大量失败也有长度上限，断言消息仍在', () => {
    const longLine = `AssertionError: ${'很长的期望值'.repeat(200)}`;
    const failures = Array.from({ length: 120 }, (_, index) =>
      [` FAIL  dir/file-${index}.test.ts > 用例 ${index}`, longLine, ...Array(20).fill('额外的报错行'), ` ❯ dir/file-${index}.test.ts:1:1`, '⎯⎯⎯[1/1]⎯'].join('\n')
    );
    const log = [...Array(10_000).fill(`噪声 ${'x'.repeat(500)}`), '⎯⎯⎯ Failed Tests 120 ⎯⎯⎯', ...failures].join('\n');
    const digest = summarizeLocalCiFailure(log, 'test');

    expect(digest.failedTestCount).toBe(120);
    expect(digest.failedTests).toHaveLength(LIMITS.tests);
    expect(digest.failedTestFiles).toHaveLength(LIMITS.files);
    expect(digest.tail).toHaveLength(LIMITS.tailLines);
    for (const failure of digest.failedTests) {
      expect(failure.message.length).toBeLessThanOrEqual(LIMITS.messageLines);
      expect(failure.message[0]).toMatch(/^AssertionError: /u);
    }
    for (const line of [...digest.tail, ...digest.failedTests.flatMap(failure => failure.message)]) {
      expect(line.length).toBeLessThanOrEqual(LIMITS.lineChars);
    }
    expect(JSON.stringify(digest).length).toBeLessThan(12_000);
  });
});
