import { describe, expect, it } from 'vitest';

import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { uiProjectionFixtures } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/__fixtures__/uiProjectionFixtures';

/**
 * 这些 RuntimeEvent 有正式生命周期，但不生成 Conversation UI read model。
 * 新增条目必须写清 owner；不能用“暂时没做 fixture”作为理由。
 */
const NON_CONVERSATION_UI_EVENT_REASONS = {
  audit_envelope: 'dev-only 审计事实，不进入用户时间线、SSE 或 UI reload',
  control: '历史变更命令由 EventStore mutation 解释，不投影为 Conversation 消息',
} as const satisfies Partial<Record<RuntimeEvent['type'], string>>;

/**
 * Linnya 对已安装 Linnkit RuntimeEvent 公共类型的完整接纳清单。
 * `satisfies Record<...>` 让 Linnkit 新增或删除事件时在类型检查阶段强制更新这里，
 * 不再读取 npm 包未承诺发布的内部 TypeScript 源文件。
 */
const RUNTIME_EVENT_UI_CLASSIFICATION = {
  user_input: 'ui',
  thought: 'ui',
  tool_call_decision: 'ui',
  tool_process: 'ui',
  tool_output: 'ui',
  subrun_trace: 'ui',
  requires_user_interaction: 'ui',
  audit_envelope: 'non-ui',
  final_answer: 'ui',
  final_answer_chunk: 'ui',
  final_answer_reset: 'ui',
  history_summary: 'ui',
  error: 'ui',
  control: 'non-ui',
  context_usage_snapshot: 'ui',
  run_execution_metrics: 'ui',
} as const satisfies Record<RuntimeEvent['type'], 'ui' | 'non-ui'>;

describe('RuntimeEvent → Conversation UI parity coverage', () => {
  it('每个正式 RuntimeEvent 必须进入 fixture 或显式登记为非 UI 事件', () => {
    const contractVariants = new Set(Object.keys(RUNTIME_EVENT_UI_CLASSIFICATION));
    const fixtureVariants = new Set<string>(
      uiProjectionFixtures.flatMap(fixture => fixture.events.map(event => event.type)),
    );
    const excludedVariants = new Set<string>(Object.keys(NON_CONVERSATION_UI_EVENT_REASONS));

    const unclassified = [...contractVariants]
      .filter(type => !fixtureVariants.has(type) && !excludedVariants.has(type))
      .sort();
    const staleExclusions = [...excludedVariants]
      .filter(type => !contractVariants.has(type))
      .sort();

    expect(unclassified, '新增事件必须补 parity fixture 或登记非 UI owner 与理由').toEqual([]);
    expect(staleExclusions, '非 UI 清单不能保留已删除或改名的事件').toEqual([]);
  });
});
