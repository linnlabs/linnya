export type WorkspaceDocumentFileWriteOperation = 'write' | 'edit';

/** 只标记已知的 provider admission 失败；正文错误由对应文档 owner 分类。 */
export class WorkspaceDocumentFileWriteError extends Error {
  readonly code = 'WORKSPACE_DOCUMENT_WRITE_PROVIDER_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceDocumentFileWriteError';
  }
}

export interface WorkspaceDocumentFileIdentity {
  readonly documentId: string;
  readonly documentName: string;
  readonly documentType: string;
  readonly projectId: string;
  readonly path: string;
  readonly inode: string;
}

export interface WorkspaceDocumentFileWriteDiagnostic {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  readonly target?: string;
}

export interface WorkspaceDocumentFileWriteRequest {
  readonly identity: WorkspaceDocumentFileIdentity;
  readonly content: string;
  readonly operation: WorkspaceDocumentFileWriteOperation;
  readonly replacedCount?: number;
  /** edit_file 执行时从 VFS current view 读到的稳定内容版本身份。 */
  readonly expectedSourceKey?: string;
  /** exact replacement 的完整读取快照；由文档 owner 在异步解析后、提交前核对。 */
  readonly expectedCurrentText?: string;
}

export interface WorkspaceDocumentFileWriteResult {
  readonly observation: string;
  readonly diagnostics?: readonly WorkspaceDocumentFileWriteDiagnostic[];
}

/**
 * 通用文件工具只依赖这一窄合同，不感知 Markdown pending 或插件 hook。
 */
export interface WorkspaceDocumentFileWriteProvider {
  readonly displayName: string;
  readonly enabled: boolean;
  readonly disabledMessage: string;
  readonly write: (
    request: WorkspaceDocumentFileWriteRequest
  ) => Promise<WorkspaceDocumentFileWriteResult>;
}

export type WorkspaceDocumentFileWriteProviderResolver = (
  documentType: string
) => WorkspaceDocumentFileWriteProvider | undefined;
