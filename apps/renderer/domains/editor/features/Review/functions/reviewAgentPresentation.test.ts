import { describe, expect, it } from 'vitest';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';
import {
  createBuiltinReviewAgents,
  readReviewAgentName,
  resolveReviewAgentName,
} from './reviewAgentPresentation';
import type { ReviewAgent } from '../definitions/reviewAgent';

const testMessage: EditorMessageResolver = (key) => {
  const messages = {
    'editor.review.agent.logicCheck.name': 'Logic check',
    'editor.review.agent.structure.name': 'Structure review',
    'editor.review.agent.polish.name': 'Text polish',
  } satisfies Partial<Record<Parameters<EditorMessageResolver>[0], string>>;

  return messages[key] ?? key;
};

describe('reviewAgentPresentation', () => {
  it('用稳定 ID 创建系统审阅角色，不在 store 中保存展示文案', () => {
    expect(createBuiltinReviewAgents()).toEqual([
      { id: 'logicCheck', knowledge: '', isCustom: false },
      { id: 'structure', knowledge: '', isCustom: false },
      { id: 'polish', knowledge: '', isCustom: false },
    ]);
  });

  it('系统角色名称从当前语言 resolver 读取，自定义角色保留用户输入名称', () => {
    const agents: ReviewAgent[] = [
      { id: 'logicCheck', knowledge: '', isCustom: false },
      { id: 'custom-a', name: '风控', systemPrompt: 'prompt', knowledge: '', isCustom: true },
    ];

    expect(readReviewAgentName(agents[0], testMessage)).toBe('Logic check');
    expect(readReviewAgentName(agents[1], testMessage)).toBe('风控');
  });

  it('历史批注可按 agentId 解析系统角色名，未知角色回落到 author 或 id', () => {
    expect(resolveReviewAgentName('structure', [], testMessage, '结构梳理')).toBe('Structure review');
    expect(resolveReviewAgentName('legacy-custom', [], testMessage, '旧角色')).toBe('旧角色');
    expect(resolveReviewAgentName('legacy-custom', [], testMessage)).toBe('legacy-custom');
  });
});
