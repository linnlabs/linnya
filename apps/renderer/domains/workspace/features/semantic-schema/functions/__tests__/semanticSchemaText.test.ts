import { describe, expect, it } from 'vitest';
import type { SemanticSchemaChangeItem } from '@app/schemas';
import { WORKSPACE_MESSAGE_FALLBACKS } from '@/domains/workspace/definitions/workspaceMessageCatalog';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import { changeMetaText, changeSummaryText, matchesQuery, tagOriginText, type SemanticSchemaTextContext } from '../semanticSchemaText';
import { usageMetaText } from '../semanticSchemaUsage';

const message: WorkspaceMessageResolver = (key, params) => Object.entries(params ?? {})
  .reduce<string>((text, [name, value]) => text.split(`{${name}}`).join(String(value)), WORKSPACE_MESSAGE_FALLBACKS[key]);

const context: SemanticSchemaTextContext = {
  message,
  agentName: id => (id === 'research' ? '研究助手' : null),
  timeText: () => '10:42',
};

const agent = { kind: 'run', conversation_id: 'c1', conversation_title: '整理资料', agent_id: null } as const;

describe('标签管理文案', () => {
  it('新建来源：Agent 带对话名，用户说“你”，迁移前的只给时间', () => {
    expect(tagOriginText(agent, 1, context)).toBe('Linnya AI 在对话“整理资料”里新建 · 10:42');
    expect(tagOriginText({ ...agent, agent_id: 'research', conversation_id: null }, 1, context)).toBe('研究助手 新建 · 10:42');
    expect(tagOriginText({ kind: 'user', conversation_id: null, conversation_title: null, agent_id: null }, 1, context)).toBe('你新建 · 10:42');
    expect(tagOriginText(null, 1, context)).toBe('新建于 10:42');
  });

  it('改动摘要与说明：计数、保存的筛选、谁、何时', () => {
    const change: SemanticSchemaChangeItem = {
      id: 'x', summary: { kind: 'merge_tags', source: '研究论文', target: '论文', objects: 3 },
      actor: { kind: 'user', conversation_id: null, conversation_title: null, agent_id: null },
      saved_filter_count: 1, created_at: 1, undone_at: null,
    };
    expect(changeSummaryText(change.summary, message)).toBe('合并标签：研究论文 → 论文');
    expect(changeMetaText(change, context)).toBe('3 份文档 · 1 个保存的筛选 · 你 · 10:42');
    const retype: SemanticSchemaChangeItem = {
      ...change, saved_filter_count: 0, actor: agent,
      summary: { kind: 'change_property_type', property: '年份', fromType: 'text', toType: 'number', objects: 11, failed: 2 },
    };
    expect(changeSummaryText(retype.summary, message)).toBe('字段“年份”改成数字');
    expect(changeMetaText(retype, context)).toBe('11 份文档，2 份转不了 · Linnya AI · 对话“整理资料” · 10:42');
    expect(changeSummaryText({
      kind: 'update_options', property: '状态', added: ['氢能'], renamed: [{ from: '在读', to: '正在读' }], removed: [], objects: 0,
    }, message)).toBe('字段“状态”的选项：新增“氢能”，改名 在读 → 正在读');
  });

  it('用在哪里的计数：没有的部分不写', () => {
    expect(usageMetaText({ projects: [], documents: [], saved_filters: [] }, message)).toBe('0 份文档');
    expect(usageMetaText({
      projects: [{ id: 'p', name: '调研', document_count: 3 }], documents: [],
      saved_filters: [{ id: 'f', name: '文稿进度', project_id: 'p', project_name: '调研', layout: 'board' }],
    }, message)).toBe('3 份文档 · 1 个项目 · 1 个保存的筛选');
  });

  it('查找忽略大小写与全角', () => {
    expect(matchesQuery('Paper 合集', 'ＰＡＰＥＲ')).toBe(true);
    expect(matchesQuery('论文', '报告')).toBe(false);
  });
});
