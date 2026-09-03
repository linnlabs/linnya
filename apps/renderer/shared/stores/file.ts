/**
 * @file apps/renderer/shared/stores/file.ts
 *
 * @brief 当前活动文件的状态管理 Store
 *
 * @description
 * 此模块是 Pinia store,专注于管理当前活动/打开的单个文件的状态和相关操作。
 *
 * 主要职责:
 * - 跟踪当前编辑文件的路径 (`currentFilePath`)
 * - 管理文件的"脏"状态 (`isDirty`),即文件自上次保存以来是否被修改
 * - 处理文件的加载 (`isLoading`) 和保存 (`isSaving`) 状态
 * - 将打开/保存等操作委托给 `file-manager` 模块，通过 `requestSave/activateFileSession`
 * - 维护统一的 dirty / loading / saving 状态，并提供窗口标题、UI 提示等反馈
 * - 仅负责状态，不再直接接触 workspaceGateway；所有实际读写由 handler 处理
 *
 * 关联文件:
 * - `apps/renderer/app/editor/ui/EditorContext.vue`: 监听脏状态，触发 `markActiveFileDirty`
 * - `apps/renderer/shared/modules/file-manager`: 统一管理所有文件类型的打开/保存/自动保存逻辑
 * - `apps/renderer/shared/extensions/keyboard/handlers/FileKeys.js`: 通过 `requestSave('manual')` 实现快捷键保存
 *
 * 重构历史:
 * - Milestone C, Task 8: 从 file.js 迁移到 file.ts
 *   - 添加完整的类型定义
 *   - 使用 fsGateway 替代 window.electronAPI
 *   - 使用 pathUtils 替代手写路径处理
 *   - 统一错误/通知处理
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { requestSave } from '../../domains/workspace/services/file-manager/index';
import type { SaveReason } from '../../domains/workspace/services/file-manager/index';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 保存前的异步钩子函数类型
 * @returns Promise<boolean> - 返回 true 表示成功，false 表示失败
 */
/**
 * 保存前的异步钩子函数类型
 *
 * 中文说明：
 * - hook 能收到本次保存的原因（manual/auto/view-switch/before-unload/...）
 * - 解决“自动保存不应打断录音，但切换页面/关闭前需要落盘”的差异化诉求
 */
export type PreSaveHook = (context: { reason: SaveReason }) => Promise<boolean>;

/**
 * 保存类型
 */
export type SaveType = 'manual' | 'auto' | 'system';

/**
 * File Store 状态接口
 */
export interface FileStoreState {
  /** 当前打开/保存的文件路径 */
  currentFilePath: Ref<string | null>;
  /** 当前打开文件的展示名称 */
  currentFileName: Ref<string | null>;
  /** 文件自上次保存后是否有修改 */
  isDirty: Ref<boolean>;
  /** 文件是否正在加载 */
  isLoading: Ref<boolean>;
  /** 文件是否正在保存 */
  isSaving: Ref<boolean>;
  /** 是否请求清空编辑器 */
  clearEditorRequested: Ref<boolean>;
  /** 自动保存间隔(毫秒),默认 30 秒 */
  autoSaveInterval: Ref<number>;
}

/**
 * File Store Getters 接口
 */
export interface FileStoreGetters {
  /** 是否有打开的文件 */
  hasOpenFile: ComputedRef<boolean>;
  /** 当前文件真实名称或 documentId */
  fileName: ComputedRef<string>;
  /** 用于 UI 显示的文件名 */
  fileDisplayName: ComputedRef<string>;
  /** 窗口标题(带未保存标记) */
  windowTitle: ComputedRef<string>;
}

/**
 * File Store Actions 接口
 */
export interface FileStoreActions {
  /** 设置当前文件路径 */
  setFilePath(path: string | null, name?: string | null): void;
  /** 设置文件是否被修改的状态 */
  setDirty(dirty: boolean): void;
  /** 设置文件加载状态 */
  setLoading(loading: boolean): void;
  /** 设置文件保存状态 */
  setSaving(saving: boolean): void;
  /** 重置文件状态 */
  resetState(): void;
  /** 请求清空编辑器 */
  requestEditorClear(): void;
  /** 设置自动保存的时间间隔 */
  setAutoSaveInterval(intervalMs: number): void;
  /** 注册一个预保存钩子 */
  registerPreSaveHook(hook: PreSaveHook): void;
  /** 执行所有预保存钩子（供 file-manager 在真正保存前调用） */
  runPreSaveHooks(reason: SaveReason): Promise<boolean>;
  /** 如果当前文件需要,则尝试保存 */
  saveCurrentFileIfNeeded(editorInstance: Editor | null, saveType?: SaveType): Promise<boolean>;
}

/**
 * File Store 完整接口
 */
export type FileStore = FileStoreState & FileStoreGetters & FileStoreActions;

// ============================================================================
// Store 定义
// ============================================================================

export const useFileStore = defineStore('file', () => {
  // --- State ---
  const currentFilePath = ref<string | null>(null); // 将存储 Document ID
  const currentFileName = ref<string | null>(null);
  const isDirty = ref(false);
  const isLoading = ref(false);
  const isSaving = ref(false);
  const clearEditorRequested = ref(false);
  const autoSaveInterval = ref(30 * 1000); // 默认 30 秒

  const preSaveHooks = ref<PreSaveHook[]>([]);
  // 防止钩子里再次触发保存导致递归
  const isRunningPreSaveHooks = ref(false);

  // --- Getters ---
  const hasOpenFile = computed(() => !!currentFilePath.value);

  /**
   * 功能 (What): 计算当前文件的文件名
   * 输入 (Input): 从 currentFilePath 中提取
   * 输出 (Output): 返回当前已知文件名；没有打开文件时返回空字符串
   * 副作用 (Side-effects): 无
   * 
   * 注意：shared store 只暴露状态事实，不生成用户可见的本地化占位名。
   */
  const fileName = computed(() => {
    if (!currentFilePath.value) {
      return '';
    }
    return currentFileName.value || currentFilePath.value;
  });

  /**
   * 功能 (What): 计算用于 UI 显示的文件名
   * 输入 (Input): 来自当前文件会话的 displayName 或 documentId
   * 输出 (Output): 返回当前文件会话已知的展示名
   * 副作用 (Side-effects): 无
   *
   * 中文说明：currentFileName 保存 workspace/VFS 边界传入的 displayName；
   * 文件后缀是否隐藏由上游决定，shared store 不认识插件格式，也不在这里猜测或剥离后缀。
   */
  const fileDisplayName = computed(() => currentFileName.value || currentFilePath.value || '');

  const windowTitle = computed(() => {
    const dirtyMark = isDirty.value ? ' *' : '';
    return fileName.value ? `${fileName.value}${dirtyMark} - AITipTap` : `AITipTap${dirtyMark}`;
  });

  // --- Actions ---

  /**
   * 设置当前文件路径
   *
   * @param path - 新的文件路径,或 null 表示未打开文件
   * @param name - 文件的可读名称
   */
  function setFilePath(path: string | null, name: string | null = null): void {
    currentFilePath.value = path;
    currentFileName.value = name;
  }

  /**
   * 设置文件是否被修改的状态
   *
   * @param dirty - true 表示已修改,false 表示未修改
   */
  function setDirty(dirty: boolean): void {
    if (isDirty.value !== dirty) {
      isDirty.value = dirty;
    }
  }

  /**
   * 设置文件加载状态
   *
   * @param loading - 是否正在加载
   */
  function setLoading(loading: boolean): void {
    isLoading.value = loading;
  }

  /**
   * 设置文件保存状态
   *
   * @param saving - 是否正在保存
   */
  function setSaving(saving: boolean): void {
    isSaving.value = saving;
  }

  /**
   * 重置文件状态(例如,用于"新建文件"或初始状态)
   */
  function resetState(): void {
    currentFilePath.value = null;
    currentFileName.value = null;
    isDirty.value = false;
    isLoading.value = false;
    isSaving.value = false;
    console.log('[FileStore] State reset');
  }

  /**
   * 请求清空编辑器
   *
   * @remarks
   * 此状态需要被 EditorContext 监听并重置为 false
   */
  function requestEditorClear(): void {
    console.log('[FileStore] Requesting editor clear...');
    clearEditorRequested.value = true;
  }

  /**
   * 设置自动保存的时间间隔
   *
   * @param intervalMs - 新的时间间隔(毫秒),必须大于 0
   */
  function setAutoSaveInterval(intervalMs: number): void {
    if (intervalMs > 0) {
      autoSaveInterval.value = intervalMs;
      console.log(`[FileStore] Auto-save interval set to: ${intervalMs} ms`);
      // TODO: 如果定时器已在运行,需要清除旧的并用新间隔重新启动
      //       这部分逻辑最好放在实际设置定时器的地方 (EditorContext)
    } else {
      console.warn('[FileStore] Invalid auto-save interval provided:', intervalMs);
    }
  }

  /**
   * 注册一个预保存钩子。
   *
   * @param hook - 保存前要执行的异步函数
   */
  function registerPreSaveHook(hook: PreSaveHook) {
    preSaveHooks.value.push(hook);
  }

  /**
   * 执行所有预保存钩子
   * 设计目标：让“保存前需要完成的异步工作”（例如 AudioBlock 终止录音并写入已保存/可重试失败态）能在保存内容快照前完成。
   */
  async function runPreSaveHooks(reason: SaveReason): Promise<boolean> {
    if (isRunningPreSaveHooks.value) {
      // 避免递归：例如某个 hook 内部又触发 requestSave
      console.warn('[FileStore] runPreSaveHooks 被重入调用，已跳过本次执行');
      return true;
    }

    if (preSaveHooks.value.length === 0) {
      return true;
    }

    isRunningPreSaveHooks.value = true;
    try {
      for (const hook of preSaveHooks.value) {
        try {
          const ok = await hook({ reason });
          if (!ok) {
            console.warn('[FileStore] 预保存钩子返回 false，已中止保存流程');
            return false;
          }
        } catch (error) {
          console.error('[FileStore] 执行预保存钩子时捕获到错误:', error);
          return false;
        }
      }
      return true;
    } finally {
      isRunningPreSaveHooks.value = false;
    }
  }

  /**
   * 如果当前文件需要,则尝试保存
   *
   * @param editorInstance - Tiptap 编辑器实例（DEPRECATED: 现在由 file-manager 和 handlers 处理）
   * @param saveType - 保存类型,默认为 'system'
   * @returns 如果尝试了保存 I/O 操作则返回 true,否则返回 false
   *
   * @remarks
   * 🔄 迁移中: 此函数保留以保证向后兼容，但内部逻辑已委托给 file-manager 模块。
   * 新的保存流程:
   * 1. 用户触发保存 (手动 Ctrl+S、自动保存、关闭前保存等)
   * 2. file-manager 接收保存请求，查找对应的 handler
   * 3. handler 从适当的源（编辑器、Engine 等）获取内容并保存
   * 
   * TODO: 待完全迁移后，可以直接导入 file-manager 的 requestSave 替代此方法
   */
  async function saveCurrentFileIfNeeded(editorInstance: Editor | null, saveType: SaveType = 'system'): Promise<boolean> {
    // 临时适配器: 存储编辑器到全局作用域，供 markdown handler 使用
    // 这是过渡方案，待 EditorContext 完全重构后可移除
    if (editorInstance) {
      (window as any).__currentEditor = editorInstance;
    }

    // 将调用委托给 file-manager
    const reason = saveType === 'manual' ? 'manual' : (saveType === 'auto' ? 'auto' : 'view-switch');
    return await requestSave(reason);
  }

  return {
    // State
    currentFilePath,
    currentFileName,
    isDirty,
    isLoading,
    isSaving,
    clearEditorRequested,
    autoSaveInterval,
    // Getters
    hasOpenFile,
    fileName,
    fileDisplayName,
    windowTitle,
    // Actions
    setFilePath,
    setDirty,
    setLoading,
    setSaving,
    resetState,
    requestEditorClear,
    setAutoSaveInterval,
    registerPreSaveHook,
    runPreSaveHooks,
    saveCurrentFileIfNeeded,
  };
});
