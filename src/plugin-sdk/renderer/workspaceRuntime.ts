import type {
  CreateWorkspaceDocumentInput,
  CreateWorkspaceDocumentOutput,
  FileSaveContext,
  FileSessionDescriptor,
  OperationResult,
  OperationResultWithData,
  WorkspaceConfirmOptions,
  WorkspaceRuntimePort,
} from '@linnya/plugin-host-contract/renderer/workspaceRuntime';

/**
 * @file workspaceRuntime.ts
 * @description 渲染端 workspace / 文件生命周期宿主能力契约。
 *
 * 中文说明：
 * - 这里不能直接 re-export host file-manager / workspaceGateway：
 *   host file-manager 入口只装配平台 handler 与插件注册能力，并实例化 Electron IPC gateway；
 * - 插件包只依赖本文件里的窄契约，真实 host 能力由 app-level installer 注册进来。
 */

export type {
  CreateWorkspaceDocumentInput,
  CreateWorkspaceDocumentOutput,
  FileSaveContext,
  FileSaveReason,
  FileSessionDescriptor,
  FileTypeLifecycleHandler,
  OperationResult,
  OperationResultWithData,
  PluginOperationDiagnostic,
  PluginOperationDiagnosticCode,
  WorkspaceConfirmOptions,
  WorkspaceRuntimePort,
} from '@linnya/plugin-host-contract/renderer/workspaceRuntime';

export class FileSessionOpenCancelledError extends Error {
  constructor(session: FileSessionDescriptor) {
    super(`[plugin-sdk] 文件打开动作已取消: ${session.type}:${session.documentId}`);
    this.name = 'FileSessionOpenCancelledError';
  }
}

export function isFileSessionOpenCancelledError(error: unknown): error is FileSessionOpenCancelledError {
  return error instanceof Error && error.name === 'FileSessionOpenCancelledError';
}

export function throwIfFileSessionOpenCancelled(session: FileSessionDescriptor): void {
  if (session.openSignal?.aborted) {
    throw new FileSessionOpenCancelledError(session);
  }
}

let workspaceRuntimePort: WorkspaceRuntimePort | null = null;

export function registerWorkspaceRuntimePort(port: WorkspaceRuntimePort): void {
  workspaceRuntimePort = port;
}

export function resetWorkspaceRuntimePortForTests(): void {
  workspaceRuntimePort = null;
}

function getWorkspaceRuntimePort(): WorkspaceRuntimePort {
  if (!workspaceRuntimePort) {
    throw new Error('[plugin-sdk/workspaceRuntime] workspace runtime port 尚未注册');
  }
  return workspaceRuntimePort;
}

export function getActiveFileSession(): FileSessionDescriptor | null {
  return getWorkspaceRuntimePort().getActiveFileSession();
}

export function getCurrentWorkspaceProjectId(): string | null {
  return getWorkspaceRuntimePort().getCurrentProjectId();
}

export function markActiveFileDirty(dirty = true): void {
  getWorkspaceRuntimePort().markActiveFileDirty(dirty);
}

export function isActiveFileDirty(): boolean {
  return getWorkspaceRuntimePort().isActiveFileDirty();
}

export function setActiveFileDirty(dirty: boolean): void {
  getWorkspaceRuntimePort().setActiveFileDirty(dirty);
}

export function setActiveFileLoading(loading: boolean): void {
  getWorkspaceRuntimePort().setActiveFileLoading(loading);
}

export function setActiveFileSaving(saving: boolean): void {
  getWorkspaceRuntimePort().setActiveFileSaving(saving);
}

export function showWorkspaceNotification(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error',
  duration?: number,
): void {
  getWorkspaceRuntimePort().showNotification(message, type, duration);
}

export function confirmWorkspaceAction(options: WorkspaceConfirmOptions): Promise<boolean> {
  return getWorkspaceRuntimePort().confirm(options);
}

export function notifyWorkspaceDocumentOpened(args: { documentId: string }): Promise<OperationResult<void>> {
  return getWorkspaceRuntimePort().notifyDocumentOpened(args);
}

export function readWorkspaceDocument(
  args: { documentId: string },
): Promise<OperationResultWithData<{ content: unknown }>> {
  return getWorkspaceRuntimePort().readDocument(args);
}

export function saveWorkspaceDocument(args: { documentId: string; content: unknown }): Promise<OperationResult<void>> {
  return getWorkspaceRuntimePort().saveDocument(args);
}

export function createWorkspaceDocument(
  args: CreateWorkspaceDocumentInput,
): Promise<OperationResultWithData<CreateWorkspaceDocumentOutput>> {
  return getWorkspaceRuntimePort().createDocument(args);
}

export function listProjectKnowledgeBaseIds(args: { projectId: string }): Promise<OperationResultWithData<string[]>> {
  return getWorkspaceRuntimePort().listKnowledgeBaseIdsForProject(args);
}
