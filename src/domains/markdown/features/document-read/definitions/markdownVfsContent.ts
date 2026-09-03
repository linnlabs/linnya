import type { DocumentCitationProjection } from '../../../../citation';

/** Markdown 文档实体对 VFS 暴露的代码即文档文本。 */
export interface MarkdownVfsContent {
  readonly contentType: 'text/markdown';
  readonly text: string;
  readonly metadata: {
    readonly versionNumber: number;
    readonly versionId: string;
    readonly view: 'current';
    readonly pendingCount: number;
  };
  readonly citationProjection: DocumentCitationProjection;
}
