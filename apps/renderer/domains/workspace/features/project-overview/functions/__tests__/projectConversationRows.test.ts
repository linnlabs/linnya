import { describe, expect, it } from 'vitest';
import type { ProjectConversationRow } from '@app/schemas';
import { EMPTY_PROJECT_CONVERSATION_FILTERS } from '../../definitions/projectConversations';
import {
  chunkConversationIds,
  filterProjectConversationRows,
  formatProjectConversationAgents,
  projectConversationRepliedAgents,
  projectConversationSubrunCount,
  projectConversationsTotalBytes,
  sortProjectConversationRows,
} from '../projectConversationRows';
import { isExcerptShown } from '../projectConversationExcerpt';

const NOW = new Date(2026, 10, 10, 15, 0);
const HOUR = 60 * 60 * 1000;

function row(id: string, extra: Partial<ProjectConversationRow> = {}): ProjectConversationRow {
  return {
    conversation_id: id,
    title: id,
    replied_agent_ids: [null],
    selected_agent_id: null,
    turn_count: 1,
    changed_document_count: 0,
    created_at: NOW.getTime() - 10 * HOUR,
    last_event_at: NOW.getTime() - HOUR,
    is_pinned: false,
    storage: null,
    ...extra,
  };
}

const storage = (bytes: number) => ({
  record_bytes: bytes,
  attachment_bytes: 0,
  has_shared_attachments: false,
  work_file_bytes: null,
  work_files_state: 'unavailable' as const,
  measured_at: 1,
});

const labels = { title: (item: ProjectConversationRow) => item.title, agent: (item: ProjectConversationRow) => item.replied_agent_ids.join() };

describe('项目对话行', () => {
  it('筛选：Agent 按回复过的匹配（空字符串是默认 Agent），最近活动按本地日历日，改过文档分有无', () => {
    const rows = [
      row('a', { replied_agent_ids: ['research_v1'], selected_agent_id: 'research_v1', changed_document_count: 2 }),
      row('b', { last_event_at: NOW.getTime() - 40 * 24 * HOUR, selected_agent_id: 'research_v1' }),
      row('c', { replied_agent_ids: ['slides_agent', null], changed_document_count: 1 }),
      row('d', { replied_agent_ids: [], selected_agent_id: 'research_v1', changed_document_count: 1 }),
    ];
    const ids = (filters: Partial<typeof EMPTY_PROJECT_CONVERSATION_FILTERS>) => filterProjectConversationRows(
      rows,
      { ...EMPTY_PROJECT_CONVERSATION_FILTERS, ...filters },
      { now: NOW, matches: null },
    ).map(item => item.conversation_id);
    expect(ids({ agent: '' })).toEqual(['b', 'c']);
    expect(ids({ agent: 'research_v1' })).toEqual(['a']);
    expect(ids({ agent: 'slides_agent' })).toEqual(['c']);
    expect(ids({ activity: 'month' })).toEqual(['a', 'c', 'd']);
    expect(ids({ documents: 'changed' })).toEqual(['a', 'c', 'd']);
    expect(ids({ documents: 'unchanged' })).toEqual(['b']);
    expect(filterProjectConversationRows(rows, EMPTY_PROJECT_CONVERSATION_FILTERS, {
      now: NOW,
      matches: new Map([['c', '命中']]),
    }).map(item => item.conversation_id)).toEqual(['c']);
  });

  it('Agent 显示：回复过的按最近在前连接，没有回复时为 null；筛选项是全部回复过的 Agent', () => {
    const name = (agentId: string | null) => agentId ?? 'Linnya Agent';
    expect(formatProjectConversationAgents(['slides_agent', null], name, '、')).toBe('slides_agent、Linnya Agent');
    expect(formatProjectConversationAgents([], name, '、')).toBeNull();
    expect(projectConversationRepliedAgents([
      row('a', { replied_agent_ids: ['research_v1', null] }),
      row('b', { replied_agent_ids: [null] }),
      row('c', { replied_agent_ids: [] }),
    ])).toEqual(['research_v1', '']);
  });

  it('子任务按全部子运行合计，不按 Agent 分列', () => {
    expect(projectConversationSubrunCount([
      { agent_id: 'research_source_review_v1', run_count: 2 },
      { agent_id: 'subagent_general', run_count: 1 },
    ])).toBe(3);
    expect(projectConversationSubrunCount([])).toBe(0);
  });

  it('排序：置顶始终在前；没测过占用的排在最后，与升降序无关', () => {
    const rows = [
      row('small', { storage: storage(10) }),
      row('unknown'),
      row('pinned', { is_pinned: true, storage: storage(1) }),
      row('large', { storage: storage(100) }),
    ];
    const ids = (direction: 'asc' | 'desc') => sortProjectConversationRows(rows, { key: 'storage', direction }, labels)
      .map(item => item.conversation_id);
    expect(ids('desc')).toEqual(['pinned', 'large', 'small', 'unknown']);
    expect(ids('asc')).toEqual(['pinned', 'small', 'large', 'unknown']);
  });

  it('总占用要等全部测完；测量按批发送', () => {
    expect(projectConversationsTotalBytes([row('a', { storage: storage(3) }), row('b')])).toBeNull();
    expect(projectConversationsTotalBytes([row('a', { storage: storage(3) }), row('b', { storage: storage(4) })])).toBe(7);
    expect(chunkConversationIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  });
});

describe('命中片段', () => {
  it('片段已在第一个问题或最后的答复里完整出现时不再显示', () => {
    expect(isExcerptShown('…德国的数字…', ['定价沿用口径，德国的数字还需要确认'])).toBe(true);
    expect(isExcerptShown('德国 渠道', [null, '德国\n渠道已整理'])).toBe(true);
    expect(isExcerptShown('中间轮次里的话', ['第一个问题', '最后的答复'])).toBe(false);
  });
});
