/** 正式 Workspace 正文结构；属性准入仍由唯一 ProseMirror schema 执行。 */
export interface WorkspaceMarkdownNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: WorkspaceMarkdownNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}
export interface MarkdownDocJson extends WorkspaceMarkdownNode {
  type: 'doc';
  content: WorkspaceMarkdownNode[];
}
