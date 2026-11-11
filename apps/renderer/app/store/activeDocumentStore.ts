import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
/** 全应用活动文档状态；打开、保存和关闭流程由文档 owner 编排。 */
export const useFileStore = defineStore('file', () => {
  // --- State ---
  const currentFilePath = ref<string | null>(null); // 将存储 Document ID
  const currentFileName = ref<string | null>(null);
  const isDirty = ref(false);
  const isLoading = ref(false);
  const isSaving = ref(false);
  const clearEditorRequested = ref(false);
  const autoSaveInterval = ref(30 * 1000); // 默认 30 秒

  // --- Getters ---
  const hasOpenFile = computed(() => !!currentFilePath.value);

  /**
   * 功能 (What): 计算当前文件的文件名
   * 输入 (Input): 从 currentFilePath 中提取
   * 输出 (Output): 返回当前已知文件名；没有打开文件时返回空字符串
   * 副作用 (Side-effects): 无
   * 
   * 注意：应用文档状态 只暴露状态事实，不生成用户可见的本地化占位名。
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
   * 文件后缀是否隐藏由上游决定，应用文档状态 不认识插件格式，也不在这里猜测或剥离后缀。
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
  };
});
