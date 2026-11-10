/**
 * 可读对话：对话里写给人看的消息——用户输入、最终答复、工具前言、被中断的答复。
 * 思考、工具调用与结果、系统提示和压缩摘要不算。其他 Agent 读别的对话、对话全文搜索、
 * 对话页详情都以这份类型清单为准（合同见 docs/conversation-platform/06-read-model.md）。
 */
export const READABLE_CONVERSATION_MESSAGE_TYPES = ['user_input', 'final_answer', 'tool_preamble', 'partial_answer'] as const;

const readableTypes = (alias: string) => `${alias}.message_type IN (${READABLE_CONVERSATION_MESSAGE_TYPES.map(type => `'${type}'`).join(', ')})`;

/**
 * 全文索引是可重建的投影：内容只在 UI 消息表里存一份，FTS5 以外部内容方式引用“可读消息”视图。
 * trigram 只用来缩小候选，是否命中由调用方再做字面比较（与项目文件 grep 相同）。
 */
export const READABLE_CONVERSATION_FTS_TABLE = `CREATE VIRTUAL TABLE IF NOT EXISTS conversation_readable_fts USING fts5(
  content,
  content='conversation_readable_messages',
  content_rowid='message_rowid',
  tokenize='trigram',
  detail='none',
  columnsize=0
)`;

/** 视图既是 FTS 的内容来源，也让整体重建只收录可读消息。 */
export const READABLE_CONVERSATION_VIEW = `CREATE VIEW IF NOT EXISTS conversation_readable_messages AS
  SELECT m.rowid AS message_rowid, m.conversation_id, m.message_type, m.sort_seq, m.timestamp, m.content
  FROM conversation_ui_messages m
  WHERE ${readableTypes('m')} AND m.content IS NOT NULL`;

/**
 * 触发器只同步可读消息。更新放在一个触发器里先撤旧再加新：同一 rowid 若先加后撤，
 * 两版共有的三字组会被误删。UI 消息用 ON CONFLICT DO UPDATE 改写，rowid 不变。
 */
export const READABLE_CONVERSATION_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS conversation_readable_after_insert
    AFTER INSERT ON conversation_ui_messages
    WHEN ${readableTypes('new')} AND new.content IS NOT NULL BEGIN
      INSERT INTO conversation_readable_fts(rowid, content) VALUES (new.rowid, new.content);
    END`,
  `CREATE TRIGGER IF NOT EXISTS conversation_readable_after_delete
    AFTER DELETE ON conversation_ui_messages
    WHEN ${readableTypes('old')} AND old.content IS NOT NULL BEGIN
      INSERT INTO conversation_readable_fts(conversation_readable_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END`,
  `CREATE TRIGGER IF NOT EXISTS conversation_readable_after_update
    AFTER UPDATE OF message_type, content ON conversation_ui_messages BEGIN
      INSERT INTO conversation_readable_fts(conversation_readable_fts, rowid, content)
        SELECT 'delete', old.rowid, old.content WHERE ${readableTypes('old')} AND old.content IS NOT NULL;
      INSERT INTO conversation_readable_fts(rowid, content)
        SELECT new.rowid, new.content WHERE ${readableTypes('new')} AND new.content IS NOT NULL;
    END`,
] as const;

export const READABLE_CONVERSATION_SCHEMAS = [
  READABLE_CONVERSATION_FTS_TABLE,
  READABLE_CONVERSATION_VIEW,
  ...READABLE_CONVERSATION_TRIGGERS,
] as const;
