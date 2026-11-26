import { describe, expect, it } from 'vitest';
import type { ConversationHistoryListItem } from '@app/schemas';
import {
  CLI_TOOL_SESSION_IDLE_MS,
  formatCliToolSessionTitle,
  selectReusableCliToolSession,
} from './cliToolSession';

function conversation(
  id: string,
  overrides: Partial<ConversationHistoryListItem> = {},
): ConversationHistoryListItem {
  return {
    conversation_id: id,
    title: id,
    created_at: 0,
    last_event_at: 1_000,
    event_count: 1,
    user_message_count: 1,
    project_id: 'project-1',
    is_pinned: false,
    selected_agent_id: null,
    origin: 'linnya_cli',
    ...overrides,
  };
}

describe('selectReusableCliToolSession', () => {
  const now = 1_000 + CLI_TOOL_SESSION_IDLE_MS;

  it('取同项目最近一段未超时的 CLI 会话，普通会话和其他项目不参与', () => {
    const picked = selectReusableCliToolSession([
      conversation('older', { last_event_at: 1_500 }),
      conversation('newer', { last_event_at: 2_000 }),
      conversation('ordinary', { last_event_at: 3_000, origin: undefined }),
      conversation('other-project', { last_event_at: 3_000, project_id: 'project-2' }),
    ], { projectId: 'project-1', now });

    expect(picked?.conversation_id).toBe('newer');
  });

  it('刚好 30 分钟仍续用，超过就不再续用', () => {
    expect(selectReusableCliToolSession([conversation('edge')], { projectId: 'project-1', now }))
      .toBeDefined();
    expect(selectReusableCliToolSession([conversation('stale')], { projectId: 'project-1', now: now + 1 }))
      .toBeUndefined();
  });
});

describe('formatCliToolSessionTitle', () => {
  it('入口名加本机日期和分钟', () => {
    const timestamp = new Date(2026, 10, 24, 9, 5).getTime();
    expect(formatCliToolSessionTitle(timestamp)).toBe('Linnya CLI · 2026-11-24 09:05');
  });
});
