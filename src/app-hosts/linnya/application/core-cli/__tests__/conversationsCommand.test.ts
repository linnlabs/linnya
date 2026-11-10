import { expect, it } from 'vitest';
import type { ProjectConversationRow } from '@app/schemas';
import { formatConversationList, formatConversationTranscript } from '../functions/formatConversations';
import { parseConversationsCommand } from '../functions/parseConversationsCommand';

it('解析 list 与 read：默认条数、翻页起点，拒绝空查询、越界条数和多余参数', () => {
  expect(parseConversationsCommand(['list'])).toEqual({ kind: 'list', query: null, limit: 30 });
  expect(parseConversationsCommand(['list', '--query', ' 定价 ', '--limit', '5'])).toEqual({ kind: 'list', query: '定价', limit: 5 });
  expect(parseConversationsCommand(['read', 'conv-a', '--after', '12'])).toEqual({ kind: 'read', conversationId: 'conv-a', afterSeq: 12, limit: 50 });
  expect(() => parseConversationsCommand(['list', '--query', '  '])).toThrow('query');
  expect(() => parseConversationsCommand(['list', '--limit', '201'])).toThrow('limit');
  expect(() => parseConversationsCommand(['read'])).toThrow('对话 ID');
  expect(() => parseConversationsCommand(['read', 'a', 'b'])).toThrow('对话 ID');
  expect(() => parseConversationsCommand(['delete', 'a'])).toThrow('list 或 read');
});

const row = (id: string, lastEventAt: number): ProjectConversationRow => ({
  conversation_id: id, title: `标题${id}`, agent_id: null, turn_count: 1, changed_document_count: 0,
  created_at: 1, last_event_at: lastEventAt, is_pinned: false, storage: null,
});

it('列表按最近活动排列，超过条数时标出截断；搜索时只列命中的对话并带片段', () => {
  const list = JSON.parse(formatConversationList({
    rows: [row('a', 1), row('b', 3), row('c', 2)], matches: null, searchTruncated: false, limit: 2, maxCharacters: 8000,
  }));
  expect(list.conversations.map((item: { id: string }) => item.id)).toEqual(['b', 'c']);
  expect(list).toMatchObject({ truncated: true, notice: expect.any(String) });
  expect(list.conversations[0]).toMatchObject({ agent: 'default' });

  const searched = JSON.parse(formatConversationList({
    rows: [row('a', 1), row('b', 3)], matches: new Map([['a', '…命中…']]), searchTruncated: false, limit: 30, maxCharacters: 8000,
  }));
  expect(searched).toMatchObject({ truncated: false, conversations: [{ id: 'a', excerpt: '…命中…' }] });
});

it('全文放不下时给出下一页起点；连第一条都放不下时截短正文并标出', () => {
  const question = { seq: 1, role: 'user' as const, type: 'user_input', at: 1, text: '短问题' };
  const answer = { seq: 2, role: 'assistant' as const, type: 'final_answer', at: 2, text: '长'.repeat(2000) };
  const page = { conversationId: 'conv-a', title: '汇报', nextAfterSeq: null, messages: [question, answer] };
  const paged = JSON.parse(formatConversationTranscript(page, 800));
  expect(paged.messages.map((message: { seq: number }) => message.seq)).toEqual([1]);
  expect(paged).toMatchObject({ nextAfterSeq: 1, notice: expect.any(String) });

  const output = formatConversationTranscript({ ...page, messages: [answer] }, 600);
  expect(output.length).toBeLessThanOrEqual(600);
  expect(JSON.parse(output)).toMatchObject({ nextAfterSeq: 2, messages: [{ seq: 2, textTruncated: true }] });
});
