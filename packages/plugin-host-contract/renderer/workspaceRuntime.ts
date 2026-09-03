import type { UserFacingMessage } from '@app/schemas';

export type OperationResult<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string; userMessage?: UserFacingMessage; diagnostic?: PluginOperationDiagnostic };

export type OperationResultWithData<T> =
  | { success: true; data: T }
  | { success: false; error: string; userMessage?: UserFacingMessage; diagnostic?: PluginOperationDiagnostic };

export type PluginOperationDiagnosticCode =
  | 'validation'
  | 'missing'
  | 'disabled'
  | 'permission_denied'
  | 'missing_handler'
  | 'crash';

export interface PluginOperationDiagnostic {
  code: PluginOperationDiagnosticCode;
  pluginId?: string;
  channel?: string;
  message: string;
}

export type FileSessionDescriptor = {
  documentId: string;
  displayName?: string | null;
  type: string;
  payload?: Record<string, unknown>;
  openSignal?: AbortSignal;
};

export type FileSaveReason =
  | 'manual'
  | 'auto'
  | 'pre-save-hook'
  | 'view-switch'
  | 'before-unload'
  | 'ai-invoke';

export type FileSaveContext = {
  reason: FileSaveReason;
  session: FileSessionDescriptor;
};

export type FileTypeLifecycleHandler = {
  type: string;
  /**
   * 重型文档可要求 host 先完成 open 预取，再挂载 surface。
   */
  deferSetFilePathUntilOpen?: boolean;
  open(session: FileSessionDescriptor): Promise<void>;
  save?(context: FileSaveContext): Promise<boolean>;
  close?(session: FileSessionDescriptor): Promise<void>;
};

export interface CreateWorkspaceDocumentInput {
  projectId: string;
  name: string;
  parentId?: string | null;
  content?: unknown;
  type?: string;
}

export interface CreateWorkspaceDocumentOutput {
  documentId: string;
}

export type WorkspaceRuntimePort = {
  getCurrentProjectId(): string | null;
  getActiveFileSession(): FileSessionDescriptor | null;
  markActiveFileDirty(dirty?: boolean): void;
  isActiveFileDirty(): boolean;
  setActiveFileDirty(dirty: boolean): void;
  setActiveFileLoading(loading: boolean): void;
  setActiveFileSaving(saving: boolean): void;
  showNotification(message: string, type: 'info' | 'success' | 'warning' | 'error', duration?: number): void;
  confirm(options: WorkspaceConfirmOptions): Promise<boolean>;
  notifyDocumentOpened(args: { documentId: string }): Promise<OperationResult<void>>;
  readDocument(args: { documentId: string }): Promise<OperationResultWithData<{ content: unknown }>>;
  saveDocument(args: { documentId: string; content: unknown }): Promise<OperationResult<void>>;
  createDocument(args: CreateWorkspaceDocumentInput): Promise<OperationResultWithData<CreateWorkspaceDocumentOutput>>;
  listKnowledgeBaseIdsForProject(args: { projectId: string }): Promise<OperationResultWithData<string[]>>;
};

export interface WorkspaceConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDangerousAction?: boolean;
}

export declare class FileSessionOpenCancelledError extends Error {
  constructor(session: FileSessionDescriptor);
}

export declare function isFileSessionOpenCancelledError(error: unknown): error is FileSessionOpenCancelledError;
export declare function throwIfFileSessionOpenCancelled(session: FileSessionDescriptor): void;
export declare function registerWorkspaceRuntimePort(port: WorkspaceRuntimePort): void;
export declare function resetWorkspaceRuntimePortForTests(): void;
export declare function getActiveFileSession(): FileSessionDescriptor | null;
export declare function getCurrentWorkspaceProjectId(): string | null;
export declare function markActiveFileDirty(dirty?: boolean): void;
export declare function isActiveFileDirty(): boolean;
export declare function setActiveFileDirty(dirty: boolean): void;
export declare function setActiveFileLoading(loading: boolean): void;
export declare function setActiveFileSaving(saving: boolean): void;
export declare function showWorkspaceNotification(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error',
  duration?: number,
): void;
export declare function confirmWorkspaceAction(options: WorkspaceConfirmOptions): Promise<boolean>;
export declare function notifyWorkspaceDocumentOpened(args: { documentId: string }): Promise<OperationResult<void>>;
export declare function readWorkspaceDocument(
  args: { documentId: string },
): Promise<OperationResultWithData<{ content: unknown }>>;
export declare function saveWorkspaceDocument(args: { documentId: string; content: unknown }): Promise<OperationResult<void>>;
export declare function createWorkspaceDocument(
  args: CreateWorkspaceDocumentInput,
): Promise<OperationResultWithData<CreateWorkspaceDocumentOutput>>;
export declare function listProjectKnowledgeBaseIds(args: { projectId: string }): Promise<OperationResultWithData<string[]>>;
