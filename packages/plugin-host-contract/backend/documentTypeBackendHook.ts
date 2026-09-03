export interface DocumentTypeBackendStatement {
  readonly get: (...params: readonly unknown[]) => unknown;
  readonly all: (...params: readonly unknown[]) => unknown[];
  readonly run: (...params: readonly unknown[]) => unknown;
}

export interface DocumentTypeBackendTransaction {
  readonly immediate: () => void;
}

export interface DocumentTypeBackendDatabase {
  readonly prepare: (sql: string) => DocumentTypeBackendStatement;
  readonly transaction: (fn: () => void) => DocumentTypeBackendTransaction;
}

export interface DocumentTypeBackendReadDatabase {
  readonly prepare: (sql: string) => DocumentTypeBackendStatement;
}

/** 插件拥有其文档投影的媒体类型，Host 只要求非空字符串。 */
export type DocumentTypeBackendContentType = string;

export interface DocumentTypeBackendReadResult {
  readonly contentType: DocumentTypeBackendContentType;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
}

export type DocumentTypeDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface DocumentTypeDiagnostic {
  /**
   * error 表示本次内容不可用或被拒绝；warning 表示已写入但建议修正；
   * info 只用于提示 agent 复核，不应阻断后续工作。
   */
  readonly severity: DocumentTypeDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly target?: string;
}

export interface DocumentTypeBackendCreateResult {
  readonly documentId: string;
  readonly toolResultData?: Record<string, unknown>;
  readonly diagnostics?: readonly DocumentTypeDiagnostic[];
}

export interface DocumentTypeBackendWriteResult {
  readonly versionNumber?: number;
  readonly toolResultData?: Record<string, unknown>;
  readonly diagnostics?: readonly DocumentTypeDiagnostic[];
}

export interface DocumentTypeBackendCreateParams {
  readonly context: import('./toolRuntime').PluginToolContext;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly content?: string;
}

export interface DocumentTypeBackendWriteParams {
  readonly context: import('./toolRuntime').PluginToolContext;
  readonly projectId: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly content: string;
  /** edit_file 从当前 VFS 文本投影读到的稳定源版本身份。 */
  readonly expectedSourceKey?: string;
}

export interface DocumentTypeBackendDuplicateParams {
  readonly context: import('./toolRuntime').PluginToolContext;
  readonly sourceDocumentId: string;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly name: string;
}

export interface DocumentTypeBackendEditorReadParams {
  readonly db: DocumentTypeBackendDatabase;
  readonly documentId: string;
  readonly documentName: string;
}

export interface DocumentTypeBackendEditorReadResult {
  readonly content: unknown;
  readonly pendingRevisions?: readonly unknown[];
}

export interface DocumentTypeBackendEditorWriteParams {
  readonly db: DocumentTypeBackendDatabase;
  readonly documentId: string;
  readonly documentName: string;
  readonly content: unknown;
}

export interface DocumentTypeBackendEditorWriteResult {
  readonly versionNumber?: number;
}

export interface DocumentTypeBackendDuplicateResult {
  readonly documentId: string;
}

export interface DocumentTypeBackendReadParams {
  readonly db: DocumentTypeBackendReadDatabase;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodePath: string;
  readonly viewKind?: string;
}

export type DocumentTypeBackendToolReadData = WorkspaceDocumentReadData;

export interface DocumentTypeBackendToolReadResult {
  readonly observation: string;
  readonly data: DocumentTypeBackendToolReadData;
}

export interface DocumentTypeBackendToolReadParams {
  readonly context: import('./toolRuntime').PluginToolContext;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly documentId: string;
  readonly documentName: string;
  readonly maxChars: number;
  readonly offsetChars: number;
  readonly structureOnly: boolean;
}

export interface DocumentTypeBackendProjectCharCountParams {
  readonly db: DocumentTypeBackendDatabase;
  readonly projectId: string;
}

export interface DocumentTypeBackendSystemViewSpec {
  readonly name: string;
  readonly viewKind: string;
}

export type DocumentTypeBackendWriteOperation = 'write' | 'edit';

export interface DocumentTypeBackendCreateObservationParams {
  readonly path: string;
  readonly inode: string;
  readonly result: DocumentTypeBackendCreateResult;
}

export interface DocumentTypeBackendWriteObservationParams {
  readonly path: string;
  readonly inode: string;
  readonly result: DocumentTypeBackendWriteResult;
  readonly operation: DocumentTypeBackendWriteOperation;
  readonly replacedCount?: number;
}

export interface DocumentTypeBackendHook {
  readonly docType: string;
  readonly displayName: string;
  readonly fileExtension?: string;
  readonly fileExtensions?: readonly string[];
  readonly systemView?: DocumentTypeBackendSystemViewSpec;
  readonly systemViews?: readonly DocumentTypeBackendSystemViewSpec[];
  readonly isEnabled?: () => boolean;
  readonly formatCreateObservation?: (params: DocumentTypeBackendCreateObservationParams) => string;
  readonly formatWriteObservation?: (params: DocumentTypeBackendWriteObservationParams) => string;
  readonly createDocument?: (
    params: DocumentTypeBackendCreateParams
  ) => Promise<DocumentTypeBackendCreateResult> | DocumentTypeBackendCreateResult;
  readonly writeDocument?: (
    params: DocumentTypeBackendWriteParams
  ) => Promise<DocumentTypeBackendWriteResult> | DocumentTypeBackendWriteResult;
  readonly readEditorDocument?: (
    params: DocumentTypeBackendEditorReadParams
  ) => DocumentTypeBackendEditorReadResult | null;
  readonly writeEditorDocument?: (
    params: DocumentTypeBackendEditorWriteParams
  ) => DocumentTypeBackendEditorWriteResult;
  readonly duplicateDocument?: (
    params: DocumentTypeBackendDuplicateParams
  ) =>
    | Promise<DocumentTypeBackendDuplicateResult | null>
    | DocumentTypeBackendDuplicateResult
    | null;
  readonly readDocument?: (
    params: DocumentTypeBackendToolReadParams
  ) => Promise<DocumentTypeBackendToolReadResult | null> | DocumentTypeBackendToolReadResult | null;
  readonly readVfsContent?: (
    params: DocumentTypeBackendReadParams
  ) => DocumentTypeBackendReadResult | null;
  readonly readProjectCharCount?: (params: DocumentTypeBackendProjectCharCountParams) => number;
}
import type { WorkspaceDocumentReadData } from '@app/schemas';
