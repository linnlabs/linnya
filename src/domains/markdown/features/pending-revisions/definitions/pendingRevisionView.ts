/** 读取投影只依赖 pending revision 的稳定事实，不依赖 SQLite 行的其余字段。 */
export interface MarkdownPendingRevisionLike {
  readonly target_block_id: string;
  readonly new_markdown: string | null;
  readonly operation?: 'insert' | 'update' | 'delete' | null;
  readonly meta_json: string | null;
}
