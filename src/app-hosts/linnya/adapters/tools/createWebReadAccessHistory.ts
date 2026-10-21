import type Database from 'better-sqlite3';
import { readConversationToolHistory, readConversationWebSourceUrls, type ConversationToolHistoryRow } from '../persistence/event-store';
import { isWebAccessBlockKind } from 'src/tools/web/shared/webFailure';
import type { WebReadAccessCounts, WebReadAccessHistoryPort } from 'src/tools/web/webread/definitions/webReadAccessHistory';
import { normalizeUrl } from 'src/tools/web/websearch/citations/normalizeUrl';

function readRequestedHostname(argumentsJson: string | null): string | undefined {
  if (argumentsJson === null) return undefined;
  try {
    const args: unknown = JSON.parse(argumentsJson);
    if (typeof args !== 'object' || args === null || !('url' in args) || typeof args.url !== 'string') return undefined;
    return new URL(args.url).hostname;
  } catch {
    // 被参数校验拒绝的请求没有可归属主机，不能猜 URL 或把它当作站点阻断。
    return undefined;
  }
}

function countAccess(
  rows: Iterable<ConversationToolHistoryRow>,
  params: Parameters<WebReadAccessHistoryPort['read']>[0],
): WebReadAccessCounts {
  // SQL 按调用身份排序；只保留当前一条调用，不随长会话积累 Map 或正文。
  let current: { runId: string; toolCallId: string; hostname?: string; status?: string | null; errorCode?: string | null } | undefined;
  let blocked = 0;
  let succeeded = 0;
  let unclassified = 0;
  const finishCall = () => {
    if (!current || current.hostname !== params.hostname) return;
    if (current.status === 'success') succeeded += 1;
    else if (current.status === 'error') {
      if (isWebAccessBlockKind(current.errorCode)) blocked += 1;
      else if (!current.errorCode || current.errorCode === 'managed_disabled') unclassified += 1;
    }
  };
  for (const row of rows) {
    if (row.runId === params.currentRunId && row.toolCallId === params.currentToolCallId) continue;
    if (!current || current.runId !== row.runId || current.toolCallId !== row.toolCallId) {
      finishCall();
      current = { runId: row.runId, toolCallId: row.toolCallId };
    }
    if (row.kind === 'decision') current.hostname = readRequestedHostname(row.argumentsJson);
    else {
      current.status = row.status;
      current.errorCode = row.errorCode;
    }
  }
  finishCall();
  return { blocked, succeeded, unclassified };
}

/** 只读正式事件，不建立第二份状态。生产 Audit 关闭、重启及恢复都不影响此投影。 */
export function createWebReadAccessHistory(getDatabase: () => Database.Database, conversationId: string): WebReadAccessHistoryPort {
  return {
    read(params) {
      return countAccess(readConversationToolHistory(getDatabase(), conversationId, 'web_read'), params);
    },
    hasObservedUrl(params) {
      const requestedUrl = normalizeUrl(params.url);
      for (const source of readConversationWebSourceUrls(getDatabase(), conversationId)) {
        if (source.runId === params.currentRunId && source.toolCallId === params.currentToolCallId) continue;
        if (normalizeUrl(source.url) === requestedUrl) return true;
      }
      return false;
    },
  };
}
