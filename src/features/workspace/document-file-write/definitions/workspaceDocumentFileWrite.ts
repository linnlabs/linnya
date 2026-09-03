export type WorkspaceDocumentFileWriteOperation = 'write' | 'edit';

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
