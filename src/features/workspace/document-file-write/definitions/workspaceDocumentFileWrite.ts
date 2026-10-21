import type { TextCharacterMetrics } from '@app/schemas';

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
  /** 文档 provider 准备编辑时捕获的稳定内容/来源版本身份，仅在内部传递。 */
  readonly expectedSourceKey?: string;
  /** exact replacement 的完整读取快照；由文档 owner 在异步解析后、提交前核对。 */
  readonly expectedCurrentText?: string;
}

export interface WorkspaceDocumentFileWriteResult {
  readonly observation: string;
  /** 仅 provider 能证明已保存的完整 current 文本时提供；插件不按请求正文猜测。 */
  readonly textMetrics?: TextCharacterMetrics;
  readonly diagnostics?: readonly WorkspaceDocumentFileWriteDiagnostic[];
}

/**
 * 通用文件工具只依赖这一窄合同，不感知 Markdown pending 或插件 hook。
 */
export interface WorkspaceDocumentFileWriteProvider {
  readonly displayName: string;
  readonly enabled: boolean;
  readonly disabledMessage: string;
  /** 内部编辑视图投影；工具不解释文档领域语法，未声明时使用原 VFS 文本。 */
  readonly prepareEdit?: (params: {
    readonly identity: WorkspaceDocumentFileIdentity;
    readonly currentText: string;
  }) => Promise<{ readonly text: string; readonly sourceKey?: string }>;
  /** 文档 owner 可接纳唯一、语义相同的转义拼写；未声明时只允许 exact。 */
  readonly resolveEquivalentEditText?: (params: {
    readonly source: string;
    readonly oldString: string;
  }) => Promise<string | null>;
  readonly write: (
    request: WorkspaceDocumentFileWriteRequest
  ) => Promise<WorkspaceDocumentFileWriteResult>;
}

export type WorkspaceDocumentFileWriteProviderResolver = (
  documentType: string
) => WorkspaceDocumentFileWriteProvider | undefined;
