export type PendingRevisionSource = 'ai' | 'user' | 'tool';

export interface PendingRevisionMetadata {
  readonly modelId?: string;
  readonly toolName?: string;
  readonly intent?: string;
  readonly confidence?: number;
  readonly oldMarkdownHash?: string;
  /** 全文导入按目标块索引保存的列表间隔；null 表示目标不是列表项。 */
  readonly listSeparatorBefore?: 'tight' | 'loose' | null;
  [key: string]: unknown;
}

export type PendingRevisionOperation = 'insert' | 'update' | 'delete';

export interface PendingRevision {
  readonly id: string;
  readonly revision: number;
  readonly document_node_id: string;
  readonly target_block_id: string;
  readonly new_markdown: string;
  readonly source: PendingRevisionSource;
  readonly operation: PendingRevisionOperation | null;
  readonly meta_json: string | null;
  readonly created_at: number;
  readonly updated_at: number | null;
}

export interface SetPendingRevisionParams {
  readonly documentId: string;
  readonly blockId: string;
  readonly newMarkdown: string;
  readonly source?: PendingRevisionSource;
  /** 显式操作类型，优先于 meta.operation。 */
  readonly operation?: PendingRevisionOperation;
  readonly meta?: PendingRevisionMetadata;
}
