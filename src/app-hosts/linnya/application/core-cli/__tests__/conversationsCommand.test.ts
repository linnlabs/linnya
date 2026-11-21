import { expect, it } from 'vitest';
import { ConversationActivitySchema, ProjectConversationQueryOptionsSchema, type ProjectConversationRow, type ProjectConversationsQuery } from '@app/schemas';
import { formatConversationList, formatConversationTranscript } from '../functions/formatConversations';
import { parseConversationsCommand } from '../functions/parseConversationsCommand';

it('解析项目查询条件，未知过滤和项目伪造参数均拒绝', () => {
  expect(parseConversationsCommand(['list'])).toEqual({ kind: 'list', query: ProjectConversationQueryOptionsSchema.parse({}), limit: 30 });
  expect(parseConversationsCommand(['list', '--query', ' 定价 ', '--agent', 'research_v1', '--activity', 'week', '--documents', 'changed', '--sort', 'title', '--limit', '5']))
    .toEqual({ kind: 'list', query: { query: '定价', agent: 'research_v1', activity: 'week', documents: 'changed', sort: 'title', direction: 'asc' }, limit: 5 });
  expect(parseConversationsCommand(['read', 'conv-a', '--after', '12'])).toEqual({ kind: 'read', conversationId: 'conv-a', afterSeq: 12, limit: 50 });
  for (const args of [['--query', '  '], ['--limit', '201'], ['--sort', 'agent'], ['--activity', 'year'], ['--project', 'other'], ['--conversation', 'other']]) {
    expect(() => parseConversationsCommand(['list', ...args])).toThrow();
  }
  expect(() => parseConversationsCommand(['read'])).toThrow('对话 ID');
  expect(() => parseConversationsCommand(['read', 'a', 'b'])).toThrow('对话 ID');
  expect(() => parseConversationsCommand(['delete', 'a'])).toThrow('list 或 read');
});

const idle = ConversationActivitySchema.parse({ state: 'idle', source: 'none', run_id: null, run_status: null, reason: null, updated_at: null, pause: null, pending_approval_count: 0 });
const row = (id: string, lastEventAt: number): ProjectConversationRow => ({
  conversation_id: id, title: `标题${id}`, replied_agent_ids: [null, 'research_v1'], selected_agent_id: 'research_v1', turn_count: 1, changed_document_count: 0,
  created_at: 1, last_event_at: lastEventAt, is_pinned: false, storage: null,
});
const result = (rows: ProjectConversationRow[]): ProjectConversationsQuery => ({
  project_id: 'project', conversations: rows, activities: Object.fromEntries(rows.map(item => [item.conversation_id, idle])), excerpts: {}, truncated: false,
});

it('输出保留 Host 查询顺序和真实状态；截断按所选顺序，不重新排序', () => {
  const list = JSON.parse(formatConversationList({ result: result([row('a', 1), row('b', 3), row('c', 2)]), limit: 2, maxCharacters: 8000 }));
  expect(list.conversations.map((item: { id: string }) => item.id)).toEqual(['a', 'b']);
  expect(list).toMatchObject({ truncated: true, notice: expect.any(String) });
  expect(list.conversations[0]).toMatchObject({ agents: ['default', 'research_v1'], selectedAgent: 'research_v1', activity: { state: 'idle', source: 'none' } });
  const searched = JSON.parse(formatConversationList({ result: { ...result([row('a', 1)]), excerpts: { a: '…命中…' } }, limit: 30, maxCharacters: 8000 }));
  expect(searched).toMatchObject({ truncated: false, conversations: [{ id: 'a', excerpt: '…命中…' }] });
});

it('全文放不下时给下一页起点；首条超长则截短，仍带当前状态', () => {
  const question = { seq: 1, role: 'user' as const, type: 'user_input', at: 1, text: '短问题' };
  const answer = { seq: 2, role: 'assistant' as const, type: 'final_answer', at: 2, text: '长'.repeat(2000) };
  const page = { conversationId: 'conv-a', title: '汇报', nextAfterSeq: null, messages: [question, answer] };
  const paged = JSON.parse(formatConversationTranscript(page, 900, idle));
  expect(paged.messages.map((message: { seq: number }) => message.seq)).toEqual([1]);
  expect(paged).toMatchObject({ conversation: { activity: { state: 'idle' } }, nextAfterSeq: 1, notice: expect.any(String) });
  const output = formatConversationTranscript({ ...page, messages: [answer] }, 650, idle);
  expect(output.length).toBeLessThanOrEqual(650);
  expect(JSON.parse(output)).toMatchObject({ nextAfterSeq: 2, messages: [{ seq: 2, textTruncated: true }] });
});
