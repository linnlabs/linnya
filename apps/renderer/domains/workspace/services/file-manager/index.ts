/**
 * @file apps/renderer/shared/modules/file-manager/index.ts
 *
 * @description
 * 一个轻量的文件类型协调模块，用于集中管理
 * 「当前活动文档」的生命周期、保存策略以及自动保存 hook。
 *
 * 设计目标：
 * 1. 统一 platform Markdown 与插件文档的打开和保存协议
 * 2. 复用 fileStore 的状态（currentFilePath / dirty / 自动保存等）
 * 3. 让各文档类型通过 register 的方式接入（开放-封闭原则）
 */

import { useFileStore, type SaveType } from '@/shared/stores/file';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';
import { FileManagerOrchestrator } from './orchestrator';
import { runSaveDeactivateThen } from './flow';

/**
 * 当前激活文件的元信息
 */
export interface FileSessionDescriptor {
  documentId: string;
  displayName?: string | null;
  /**
   * markdown | <plugin-session-type> | ...
   */
  type: string;
  /**
   * 可选附加数据（如项目 ID、父节点 ID 等）
   */
  payload?: Record<string, unknown>;
  /**
   * 当前打开动作的取消信号。
   *
   * 中文说明：这是 file-manager 的生命周期契约，不是 UI 兜底。
   * 当用户快速切换文档时，旧打开动作必须在写入 runtime 前停止。
   */
  openSignal?: AbortSignal;
}

export class FileSessionOpenCancelledError extends Error {
  constructor(session: FileSessionDescriptor) {
    super(`[file-manager] 文件打开动作已取消: ${session.type}:${session.documentId}`);
    this.name = 'FileSessionOpenCancelledError';
  }
}

export function isFileSessionOpenCancelledError(error: unknown): error is FileSessionOpenCancelledError {
  return error instanceof FileSessionOpenCancelledError;
}

export function throwIfFileSessionOpenCancelled(session: FileSessionDescriptor): void {
  if (session.openSignal?.aborted) {
    throw new FileSessionOpenCancelledError(session);
  }
}

/**
 * 保存上下文
 */
export interface FileSaveContext {
  reason: SaveReason;
  session: FileSessionDescriptor;
}

/**
 * 支持的保存原因，可根据需要继续扩展
 */
export type SaveReason =
  | 'manual' // 用户主动保存 (Ctrl+S)
  | 'auto' // 自动保存计时器
  | 'pre-save-hook' // fileStore.registerPreSaveHook
  | 'view-switch' // 切换视图前
  | 'before-unload' // 关闭应用/窗口
  | 'ai-invoke'; // 在调用 AI 前主动保存，避免前后端文档内容不一致

/**
 * 各文件类型需要实现的接口
 */
export interface FileTypeLifecycleHandler {
  type: string;
  /**
   * 中文说明：重型 surface 需要先完成 handler.open 准备运行时上下文，再切换 filePath 触发挂载。
   * 这是 file lifecycle 的通用时序契约，不属于任何具体插件。
   */
  deferSetFilePathUntilOpen?: boolean;
  /**
   * 打开文件（负责具体的加载逻辑）
   */
  open(session: FileSessionDescriptor): Promise<void>;
  /**
   * 保存文件（在自动保存 / 关闭前保存等情况下被调用）
   */
  save?(context: FileSaveContext): Promise<boolean>;
  /**
   * 可选：关闭时做一些清理
   */
  close?(session: FileSessionDescriptor): Promise<void>;
}

const handlerRegistry = new Map<string, FileTypeLifecycleHandler>();
let activeSession: FileSessionDescriptor | null = null;
let hooksInitialized = false;
let autoSaveInitialized = false;
let autoSaveTimer: number | null = null;

// 串行编排器：所有“会改变 activeSession / filePath / 保存状态”的操作必须走这里
const orchestrator = new FileManagerOrchestrator();

/**
 * 获取当前激活的文件会话（只读快照）
 *
 * 中文说明：
 * - `activeSession` 是 file-manager 内部的权威状态源
 * - 插件模块可能需要读取它，但不应直接修改
 * - 这里返回浅拷贝，避免外部意外篡改内部对象引用
 */
export function getActiveFileSession(): FileSessionDescriptor | null {
  return activeSession ? { ...activeSession } : null;
}

/**
 * 注册某个文件类型的处理器
 */
export function registerFileTypeHandler(handler: FileTypeLifecycleHandler) {
  handlerRegistry.set(handler.type, handler);
  ensureHooks();
}

export async function unregisterFileTypeHandler(type: string): Promise<void> {
  const normalizedType = type.trim();
  if (!normalizedType) return;
  if (activeSession?.type === normalizedType) {
    await deactivateFileSession();
  }
  handlerRegistry.delete(normalizedType);
}

/**
 * 激活一个新的 platform 或插件文件会话
 */
export async function activateFileSession(session: FileSessionDescriptor) {
  ensureHooks();
  return orchestrator.enqueue('activateFileSession', async () => {
    await activateFileSessionInternal(session);
  });
}

/**
 * 手动触发保存（供外部在特定场景调用，例如切换视图）
 */
export async function requestSave(reason: SaveReason = 'manual'): Promise<boolean> {
  ensureHooks();
  return orchestrator.enqueue('requestSave', async () => {
    return await runActiveSaveInternal(reason);
  });
}

/**
 * 主动关闭当前文件会话。
 *
 * 中文说明：
 * - 用于“离开文件编辑视图”的场景（Linnya 助手/项目对话/知识库等）；
 * - 会调用 handler.close，清理 activeSession 与文件脏状态，避免后续误对旧会话触发保存。
 */
export async function deactivateFileSession(options?: { clearFilePath?: boolean }): Promise<void> {
  ensureHooks();
  return orchestrator.enqueue('deactivateFileSession', async () => {
    await deactivateFileSessionInternal(options);
  });
}

/**
 * 删除节点前的会话收尾：如果要删除的就是当前 activeSession，则先关闭会话（不做保存）。
 *
 * 中文说明（根因修复）：
 * - 右键删除/批量删除会先调用后端 delete-node；
 * - 若删除的是当前打开的文档，随后 UI 的“选区兜底/视图切换”会触发 view-switch 保存；
 * - 此时文档已不存在，保存必然收到 DOCUMENT_NOT_FOUND，造成“删除也报保存失败”的错觉。
 * - 因此这里提供一个可复用的编排入口：先 deactivate（close/destroy），再执行真正的 delete。
 */
export async function deactivateIfActiveDocument(documentId: string): Promise<void> {
  ensureHooks();
  return orchestrator.enqueue('deactivateIfActiveDocument', async () => {
    const normalizedDocumentId = documentId.trim();
    if (normalizedDocumentId.length === 0) return;
    if (!activeSession) return;
    if (activeSession.documentId !== normalizedDocumentId) return;
    await deactivateFileSessionInternal();
  });
}

/**
 * 编排：保存（view-switch）→ deactivate → 执行 action（常用于安全切视图）。
 *
 * 中文说明：
 * - 必须作为单个 orchestrator 任务执行，避免 requestSave/deactivate/action 被其他任务插队打断。
 */
export async function saveDeactivateThen(
  action: () => void | Promise<void>,
  options?: { throwOnSaveFailure?: boolean }
): Promise<void> {
  ensureHooks();
  return orchestrator.enqueue('saveDeactivateThen', async () => {
    await runSaveDeactivateThen({
      save: () => runActiveSaveInternal('view-switch'),
      deactivate: () => deactivateFileSessionInternal(),
      action,
      throwOnSaveFailure: options?.throwOnSaveFailure !== false,
    });
  });
}

/**
 * 设置当前文档 dirty 状态（供插件在修改后通过公开协议调用）
 */
export function markActiveFileDirty(dirty = true) {
  const fileStore = useFileStore();
  fileStore.setDirty(dirty);
}

/**
 * 列出已注册的文件类型（用于调试或文档展示）
 */
export function getRegisteredFileTypes(): string[] {
  return Array.from(handlerRegistry.keys());
}

// ---------------------------------------------------------------------------
// 内部方法
// ---------------------------------------------------------------------------

/**
 * 确保只注册一次 fileStore 的 pre-save hook
 */
function ensureHooks() {
  if (hooksInitialized) return;
  const fileStore = useFileStore();
  // 注意：preSaveHooks 的真正执行发生在 runActiveSave 内部。
  // 这里不再用“保存触发保存”的方式注册，避免递归和逻辑混乱。
  initAutoSaveScheduler(fileStore);
  hooksInitialized = true;
}

function initAutoSaveScheduler(fileStore: ReturnType<typeof useFileStore>) {
  if (autoSaveInitialized) return;
  autoSaveInitialized = true;

  const { autoSaveInterval, currentFilePath, isDirty, isSaving, isLoading } = storeToRefs(fileStore);

  const restartTimer = () => {
    if (autoSaveTimer) {
      window.clearInterval(autoSaveTimer);
      autoSaveTimer = null;
    }

    const interval = autoSaveInterval.value;
    if (!interval || interval <= 0) {
      return;
    }

    autoSaveTimer = window.setInterval(() => {
      if (
        !currentFilePath.value ||
        !isDirty.value ||
        isSaving.value ||
        isLoading.value
      ) {
        return;
      }

      requestSave('auto').catch((error) => {
        console.error('[file-manager] 自动保存失败:', error);
      });
    }, interval);
  };

  watch(autoSaveInterval, () => restartTimer(), { immediate: true });
}

async function runActiveSaveInternal(reason: SaveReason): Promise<boolean> {
  console.log('[file-manager] runActiveSave 调用', {
    reason,
    activeSession: activeSession ? { type: activeSession.type, documentId: activeSession.documentId } : null,
  });
  console.debug('[file-manager] runActiveSave:entry', {
    reason,
    activeSessionType: activeSession?.type ?? null,
    activeSessionDocId: activeSession?.documentId ?? null,
  });

  if (!activeSession) {
    console.log('[file-manager] runActiveSave: 无 activeSession，跳过');
    return true;
  }
  const handler = handlerRegistry.get(activeSession.type);
  if (!handler?.save) {
    console.log('[file-manager] runActiveSave: handler 无 save 方法，跳过', { type: activeSession.type });
    return true;
  }

  console.log('[file-manager] runActiveSave: 准备调用 handler.save', { type: activeSession.type });

  try {
    // -----------------------------------------------------------------------
    // 保存前钩子：让各模块有机会在“内容快照保存”前完成异步收尾
    // 典型场景：AudioBlock 正在录音时，先停止录音并写入“已保存/可重试失败”态，最后再保存文档。
    // -----------------------------------------------------------------------
    const fileStore = useFileStore();
    const hooksOk = await fileStore.runPreSaveHooks(reason);
    if (!hooksOk) {
      return false;
    }

    const ok = await handler.save({
      reason,
      session: activeSession,
    });
    if (ok && reason !== 'manual') {
      // 自动保存成功后，统一清空 dirty 状态
      markActiveFileDirty(false);
    }
    return ok;
  } catch (error) {
    console.error('[file-manager] 保存失败:', error);
    return false;
  }
}

async function deactivateFileSessionInternal(options?: { clearFilePath?: boolean }): Promise<void> {
  const fileStore = useFileStore();
  const clearFilePath = options?.clearFilePath !== false;

  if (!activeSession) {
    if (clearFilePath) {
      fileStore.setFilePath(null, null);
    }
    fileStore.setDirty(false);
    return;
  }

  const currentSession = activeSession;
  const handler = handlerRegistry.get(currentSession.type);
  if (handler?.close) {
    await handler.close(currentSession);
  }

  activeSession = null;
  fileStore.setDirty(false);
  if (clearFilePath) {
    fileStore.setFilePath(null, null);
  }
}

async function activateFileSessionInternal(session: FileSessionDescriptor): Promise<void> {
  const fileStore = useFileStore();

  throwIfFileSessionOpenCancelled(session);

  console.log('[file-manager] activateFileSession 调用', {
    newSession: { documentId: session.documentId, type: session.type },
    currentSession: activeSession ? { documentId: activeSession.documentId, type: activeSession.type } : null,
  });

  // -------------------------------------------------------------------------
  // 切换会话前：先保存当前会话（包含预保存钩子，例如 AudioBlock 停止录音并落盘）
  // 重要：必须发生在切换 activeSession / filePath 之前，否则保存会落到新会话上。
  // -------------------------------------------------------------------------
  if (activeSession && activeSession.documentId !== session.documentId) {
    console.log('[file-manager] 检测到会话切换，准备保存旧会话', {
      oldType: activeSession.type,
      oldDocId: activeSession.documentId,
    });
    const ok = await runActiveSaveInternal('view-switch');
    if (!ok) {
      // 这里选择阻止切换：避免"切走导致录音/内容丢失"
      throw new Error('[file-manager] 切换文件前保存失败，已取消切换');
    }

    // 保存完成后关闭旧会话，避免旧会话残留导致后续生命周期错乱
    const previousHandler = handlerRegistry.get(activeSession.type);
    if (previousHandler?.close) {
      await previousHandler.close(activeSession);
    }
    console.log('[file-manager] 旧会话保存完成');
  }

  const handler = handlerRegistry.get(session.type);
  if (!handler) {
    throw new Error(`[file-manager] 未注册类型 "${session.type}" 的处理器`);
  }

  const shouldDeferSetFilePath = handler.deferSetFilePathUntilOpen === true;
  console.debug('[file-manager] activateFileSession:setFilePathTiming', {
    nextDocumentId: session.documentId,
    nextType: session.type,
    prevDocumentId: activeSession?.documentId ?? null,
    prevType: activeSession?.type ?? null,
    deferSetFilePath: shouldDeferSetFilePath,
  });
  if (!shouldDeferSetFilePath) {
    throwIfFileSessionOpenCancelled(session);
    fileStore.setFilePath(session.documentId, session.displayName ?? null);
  }
  activeSession = session;
  console.log('[file-manager] activeSession 已更新为', { type: session.type, documentId: session.documentId });
  console.debug('[file-manager] activateFileSession:after-activeSession', {
    currentFilePath: fileStore.currentFilePath,
    activeSessionDocId: activeSession.documentId,
    activeSessionType: activeSession.type,
    deferSetFilePath: shouldDeferSetFilePath,
  });

  console.debug('[file-manager] activateFileSession:before-handler-open', {
    documentId: session.documentId,
    type: session.type,
  });
  try {
    throwIfFileSessionOpenCancelled(session);
    await handler.open(session);
    throwIfFileSessionOpenCancelled(session);
    if (shouldDeferSetFilePath) {
      fileStore.setFilePath(session.documentId, session.displayName ?? null);
      console.debug('[file-manager] activateFileSession:setFilePath-post-open', {
        documentId: session.documentId,
        currentFilePath: fileStore.currentFilePath,
      });
    }
  } catch (error) {
    if (activeSession?.documentId === session.documentId && activeSession.type === session.type) {
      activeSession = null;
    }
    if (fileStore.currentFilePath === session.documentId) {
      fileStore.setFilePath(null, null);
    }
    fileStore.setDirty(false);
    if (isFileSessionOpenCancelledError(error)) {
      console.debug('[file-manager] activateFileSession:open-cancelled', {
        documentId: session.documentId,
        type: session.type,
      });
    }
    throw error;
  }
  console.debug('[file-manager] activateFileSession:after-handler-open', {
    documentId: session.documentId,
    type: session.type,
    currentFilePath: fileStore.currentFilePath,
  });
}

// 导出 handlers
export { markdownHandler } from './handlers/markdown';
