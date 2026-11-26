import {
  formatAgentTimestamp,
  projectConversationActorIds,
  type ConversationActivity,
  type ProjectConversationRow,
  type ProjectConversationsQuery,
} from '@app/schemas';
import type { ConversationTranscriptPage } from '../../project-conversations';

const listNotice = '结果超过条数或输出上限，只列出按所选条件排序的一部分。可用 --query、--agent、--activity 或 --documents 缩小范围。';
const readNotice = '没有读完。用 nextAfterSeq 作为 --after 继续读下一页。';
const scopeNote = '只含当前项目的对话；内容只含用户的话与 AI 的答复，不含思考和工具过程。';

function projectRow(row: ProjectConversationRow, activity: ConversationActivity, excerpt: string | null | undefined) {
  return {
    id: row.conversation_id,
    title: row.title,
    // 发起入口（Linnya CLI 创建的对话为 linnya_cli）在前，其后是回复过的 Agent（最近的在前）；默认 Agent 写作 default。
    // 这些值就是 --agent 的筛选值。selectedAgent 是当前选用的 Agent。
    agents: projectConversationActorIds(row).map(actorId => actorId ?? 'default'),
    selectedAgent: row.selected_agent_id ?? 'default',
    activity,
    turns: row.turn_count,
    changedDocuments: row.changed_document_count,
    createdAt: formatAgentTimestamp(row.created_at),
    lastActivityAt: formatAgentTimestamp(row.last_event_at),
    ...(excerpt ? { excerpt } : {}),
  };
}

/** Host 已筛选排序；这里只预算输出，不改变列表顺序。 */
export function formatConversationList(input: {
  readonly result: ProjectConversationsQuery;
  readonly limit: number;
  readonly maxCharacters: number;
}): string {
  const ordered = input.result.conversations;
  const conversations: ReturnType<typeof projectRow>[] = [];
  let truncated = input.result.truncated || ordered.length > input.limit;
  let used = JSON.stringify({ truncated: true, notice: listNotice, scope: scopeNote, conversations }).length + 1;
  for (const row of ordered.slice(0, input.limit)) {
    const activity = input.result.activities[row.conversation_id];
    if (!activity) throw new Error('Conversation query did not return activity');
    const item = projectRow(row, activity, input.result.excerpts[row.conversation_id]);
    used += JSON.stringify(item).length + (conversations.length ? 1 : 0);
    if (used > input.maxCharacters) {
      truncated = true;
      break;
    }
    conversations.push(item);
  }
  return JSON.stringify({ truncated, ...(truncated ? { notice: listNotice } : {}), scope: scopeNote, conversations }) + '\n';
}

/**
 * 一页可读消息。放不下的消息留给下一页；连第一条都放不下时截短这一条的正文并标出，
 * 不让一条超长答复卡住翻页。
 */
export function formatConversationTranscript(page: ConversationTranscriptPage, maxCharacters: number, activity: ConversationActivity): string {
  const conversation = { id: page.conversationId, title: page.title, activity };
  const messages: Record<string, unknown>[] = [];
  let used = JSON.stringify({ conversation, scope: scopeNote, messages, nextAfterSeq: Number.MAX_SAFE_INTEGER, notice: readNotice }).length + 1;
  let nextAfterSeq = page.nextAfterSeq;
  let lastSeq: number | null = null;
  for (const message of page.messages) {
    const item = { seq: message.seq, role: message.role, type: message.type, at: formatAgentTimestamp(message.at), text: message.text };
    const size = JSON.stringify(item).length + (messages.length ? 1 : 0);
    if (used + size <= maxCharacters) {
      messages.push(item);
      used += size;
      lastSeq = message.seq;
      continue;
    }
    if (lastSeq === null) {
      messages.push(clipToFit(item, maxCharacters - used));
      nextAfterSeq = message.seq;
    } else {
      nextAfterSeq = lastSeq;
    }
    break;
  }
  return JSON.stringify({
    conversation,
    scope: scopeNote,
    messages,
    ...(nextAfterSeq === null ? {} : { nextAfterSeq, notice: readNotice }),
  }) + '\n';
}

/** 截短正文直到整条（序列化后）放得进剩余空间；按码点截，不切开代理对。 */
function clipToFit<T extends { readonly text: string }>(item: T, room: number): T & { readonly textTruncated: true } {
  const codePoints = Array.from(item.text);
  let low = 0;
  let high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = { ...item, text: codePoints.slice(0, middle).join(''), textTruncated: true as const };
    if (JSON.stringify(candidate).length <= room) low = middle;
    else high = middle - 1;
  }
  return { ...item, text: codePoints.slice(0, low).join(''), textTruncated: true };
}
