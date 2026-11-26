import { describe, expect, it } from 'vitest';
import type { ProjectConversationRow } from '@app/schemas';
import {
  chunkConversationIds,
  formatProjectConversationActors,
  projectConversationActorFilterValues,
  projectConversationSubrunCount,
  projectConversationsTotalBytes,
  sortProjectConversationsByAgentLabel,
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


describe('项目对话行', () => {
  it('Agent 列：回复过的按最近在前连接，没有回复时为 null；筛选项是全部回复过的 Agent', () => {
    const name = (agentId: string | null) => agentId ?? 'Linnya Agent';
    expect(formatProjectConversationActors(row('a', { replied_agent_ids: ['slides_agent', null] }), name, '、')).toBe('slides_agent、Linnya Agent');
    expect(formatProjectConversationActors(row('b', { replied_agent_ids: [] }), name, '、')).toBeNull();
    expect(projectConversationActorFilterValues([
      row('a', { replied_agent_ids: ['research_v1', null] }),
      row('b', { replied_agent_ids: [null] }),
      row('c', { replied_agent_ids: [] }),
    ])).toEqual(['research_v1', '']);
  });

  it('Linnya CLI 创建的对话：Agent 列只显示入口，筛选项多一个入口值，不冒出默认 Agent', () => {
    const name = (actorId: string | null) => actorId ?? 'Linnya Agent';
    const cli = row('cli', { origin: 'linnya_cli', replied_agent_ids: [] });
    expect(formatProjectConversationActors(cli, name, '、')).toBe('linnya_cli');
    expect(projectConversationActorFilterValues([cli, row('a', { replied_agent_ids: ['research_v1'] })]))
      .toEqual(['linnya_cli', 'research_v1']);
  });

  it('子任务按全部子运行合计，不按 Agent 分列', () => {
    expect(projectConversationSubrunCount([
      { agent_id: 'research_source_review_v1', run_count: 2 },
      { agent_id: 'subagent_general', run_count: 1 },
    ])).toBe(3);
    expect(projectConversationSubrunCount([])).toBe(0);
  });

  it('Agent 展示名排序保留置顶、中文名称与稳定活动顺序', () => {
    const rows = [row('b'), row('pinned', { is_pinned: true }), row('a')];
    expect(sortProjectConversationsByAgentLabel(rows, 'asc', item => item.title).map(item => item.conversation_id))
      .toEqual(['pinned', 'a', 'b']);
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
