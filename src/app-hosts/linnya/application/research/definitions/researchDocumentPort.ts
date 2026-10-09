/** Host 交接绑定的是完整 current 投影，不能把它称为数据库 revision。 */
export interface ResearchDocumentBinding {
  readonly inode: string;
  readonly locator: string;
  readonly representation: 'workspace-markdown-current-v1';
  readonly sha256: string;
  readonly citationSha256: string;
}

export interface ResearchDocumentSnapshot extends ResearchDocumentBinding {
  readonly text: string;
}

export type ResearchDocumentReadRequest = {
  readonly projectId: string;
} & (
  | { readonly locator: string; readonly inode?: never }
  | { readonly inode: string; readonly locator?: never }
);

export interface ResearchDocumentSaveRequest {
  readonly projectId: string;
  readonly conversationId: string;
  /** 必须是实际产出这份正文的 run；不得改用协调者的引用作用域。 */
  readonly sourceRunId: string;
  /** 预先冻结的新 workspace:/... Markdown 路径，已存在时必须失败。 */
  readonly path: string;
  readonly text: string;
  /** prepare 在编译前；commit 与 Workspace 创建共用同步事务，抛错连同新稿一起回滚。 */
  readonly receipt: {
    prepare(): void;
    commit(binding: ResearchDocumentBinding): void;
  };
}

export interface ResearchDocumentPort {
  read(request: ResearchDocumentReadRequest): Promise<ResearchDocumentSnapshot>;
  save(request: ResearchDocumentSaveRequest): Promise<ResearchDocumentSnapshot>;
}

export type ResearchDocumentErrorCode =
  | 'RESEARCH_DOCUMENT_MISSING'
  | 'RESEARCH_DOCUMENT_TRUNCATED'
  | 'RESEARCH_DOCUMENT_INVALID'
  | 'RESEARCH_DOCUMENT_CITATION_INVALID'
  | 'RESEARCH_DOCUMENT_PATH_INVALID';

export class ResearchDocumentError extends Error {
  constructor(readonly code: ResearchDocumentErrorCode, message: string) {
    super(message);
    this.name = 'ResearchDocumentError';
  }
}
