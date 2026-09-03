/** Markdown 正文的一条持久化版本。 */
export interface MarkdownDocumentVersion {
  readonly id: string;
  readonly node_id: string;
  readonly version_number: number;
  readonly content_json: string;
  /** 中文按汉字、英文按单词统计的内容单位数。 */
  readonly char_count: number;
  readonly created_at: number;
  readonly author_id: string | null;
}

export interface SaveMarkdownDocumentVersionInput {
  readonly nodeId: string;
  readonly contentJson: string;
  readonly charCount: number;
  readonly authorId: string | null;
  readonly createdAt: number;
}
