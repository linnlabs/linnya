import type Database from 'better-sqlite3';

export interface ConversationWebSourceUrlRow {
  readonly runId: string;
  readonly toolCallId: string;
  readonly url: string;
}

/**
 * 只投影已成功交付的 Web 来源身份及资源链接。正文、observation 和失败请求均不读取；
 * SQL 内从正式 data 字段逐条取 URL，避免把长网页或其他会话内容物化到调用方内存。
 */
export function readConversationWebSourceUrls(
  db: Database.Database,
  conversationId: string,
): Iterable<ConversationWebSourceUrlRow> {
  return db.prepare<[string], ConversationWebSourceUrlRow>(`
    WITH completed_web_outputs AS (
      SELECT e.run_id AS runId,
        json_extract(e.payload, '$.tool_call_id') AS toolCallId,
        json_extract(e.payload, '$.tool_name') AS toolName,
        json_extract(e.payload, '$.data') AS data
      FROM events e JOIN runs r ON r.id = e.run_id
      WHERE r.conversation_id = ? AND e.type = 'tool_output'
        AND json_extract(e.payload, '$.status') = 'success'
        AND json_extract(e.payload, '$.tool_name') IN ('web_search', 'search_web', 'web_read')
    )
    SELECT runId, toolCallId, json_extract(c.value, '$.url') AS url
    FROM completed_web_outputs, json_each(data, '$.citations.citations') c
    WHERE json_type(c.value, '$.url') = 'text'
    UNION ALL
    SELECT runId, toolCallId, json_extract(resource.value, '$.url') AS url
    FROM completed_web_outputs, json_each(data, '$.resources') resource
    WHERE toolName = 'web_read' AND json_type(resource.value, '$.url') = 'text'
    UNION ALL
    SELECT runId, toolCallId, json_extract(data, '$.file.requestedUrl') AS url
    FROM completed_web_outputs
    WHERE toolName = 'web_read' AND json_type(data, '$.file.requestedUrl') = 'text'
    UNION ALL
    SELECT runId, toolCallId, json_extract(data, '$.file.finalUrl') AS url
    FROM completed_web_outputs
    WHERE toolName = 'web_read' AND json_type(data, '$.file.finalUrl') = 'text'
  `).iterate(conversationId);
}
