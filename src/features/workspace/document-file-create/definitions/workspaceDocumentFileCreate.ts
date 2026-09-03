import type {
  WorkspaceDocumentFileWriteDiagnostic,
} from '../../document-file-write/definitions/workspaceDocumentFileWrite';

export interface WorkspaceDocumentFileCreateRequest {
  readonly projectId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly content: string;
}

export interface WorkspaceCreatedFileIdentity {
  readonly path: string;
  readonly inode: string;
}

export interface WorkspaceDocumentFileCreateResult {
  readonly documentId: string;
  readonly diagnostics?: readonly WorkspaceDocumentFileWriteDiagnostic[];
  readonly buildObservation: (identity: WorkspaceCreatedFileIdentity) => string;
}

export interface WorkspaceDocumentFileCreateProvider {
  readonly displayName: string;
  readonly enabled: boolean;
  readonly disabledMessage: string;
  readonly create: (
    request: WorkspaceDocumentFileCreateRequest,
  ) => Promise<WorkspaceDocumentFileCreateResult>;
}

/** 文件尚不存在，因此创建 provider 只能按已声明的文件名格式解析。 */
export type WorkspaceDocumentFileCreateProviderResolver = (
  fileName: string,
) => WorkspaceDocumentFileCreateProvider | undefined;

export interface WorkspaceDocumentFileCreateFormat {
  readonly displayName: string;
  readonly extensions: readonly string[];
}
