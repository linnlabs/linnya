import { describe, expect, it } from 'vitest';

import {
  analyzeRuntimeIdentityAssertions,
  runRuntimeIdentityAssertionGuard,
} from '../guards/runtime-identity-assertion-guard';

const FILE = 'src/app-hosts/linnya/adapters/runtime/example.ts';

describe('runtime identity assertion guard', () => {
  // 该断言需要遍历并解析生产源码，完整测试并行时不应受 5 秒单元测试默认值限制。
  it('当前生产代码不存在身份断言绕过', () => {
    expect(runRuntimeIdentityAssertionGuard()).toEqual([]);
  }, 30_000);

  it.each([
    ['RunId', 'const runId = raw as RunId;'],
    ['ToolCallId', 'const toolCallId = <ToolCallId>raw;'],
    ['可选身份', 'const runId = raw as RunId | undefined;'],
  ])('捕获直接 %s 断言', (_name, source) => {
    expect(analyzeRuntimeIdentityAssertions(FILE, source).map(item => item.rule)).toEqual([
      'RUNTIME-ID-01-direct-assertion',
    ]);
  });

  it.each([
    ['RuntimeEvent', 'const event = raw as RuntimeEvent;'],
    ['RoutedRuntimeEvent[]', 'const history = raw as RoutedRuntimeEvent[];'],
    ['SSEEvent', 'const event = raw as Readonly<SSEEvent>;'],
    ['RunRecord', 'const run = raw as RunRecord;'],
    ['RunMeta', 'const meta = raw as RunMeta;'],
    ['StandardToolCall', 'const call = raw as StandardToolCall;'],
  ])('捕获载体断言 %s', (_name, source) => {
    expect(analyzeRuntimeIdentityAssertions(FILE, source).map(item => item.rule)).toEqual([
      'RUNTIME-ID-02-carrier-assertion',
    ]);
  });

  it('不误报 schema parse、普通类型收窄和 satisfies', () => {
    const source = [
      'const runId = RunIdSchema.parse(raw);',
      'const payload = raw as Record<string, unknown>;',
      "const event = value satisfies { type: 'control' };",
    ].join('\n');
    expect(analyzeRuntimeIdentityAssertions(FILE, source)).toEqual([]);
  });

  it('解析 Vue script 并报告 SFC 真实行号', () => {
    const source = [
      '<template><div /></template>',
      '<script setup lang="ts">',
      'const runId = raw as RunId;',
      '</script>',
    ].join('\n');
    const violations = analyzeRuntimeIdentityAssertions(
      'apps/renderer/domains/conversation/Example.vue',
      source
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(3);
  });
});
