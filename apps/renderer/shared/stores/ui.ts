import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import type { RendererUiTheme } from '@linnya/renderer-ui/theme'
import { getRendererPersistStorage } from '../persistence/rendererPersistStorage'
import type {
  AiPromptPosition,
  AiPromptTriggerPos,
  UiEditorInstance,
} from '../types'

let currentEditorInstance: UiEditorInstance = null;

const createDefaultTheme = (): RendererUiTheme => 'light';

export const DEFAULT_SIDEBAR_WIDTH = 260;

export const SIDEBAR_WIDTH_LIMITS = {
  min: 200,
  max: 500,
} as const;

function clampSidebarWidth(width: number): number {
  return Math.min(
    SIDEBAR_WIDTH_LIMITS.max,
    Math.max(SIDEBAR_WIDTH_LIMITS.min, Math.round(width)),
  );
}

export const useUIStore = defineStore('ui', {
  state: () => ({
    // 侧边栏状态
    sidebarVisible: true,
    // 主题状态，从localStorage读取或默认为light
    // 仅设置默认值，持久化由插件处理
    theme: createDefaultTheme(),
    // 设置模态窗口状态
    settingsModalVisible: false,
    settingsInitialTabId: null as string | null,
    // 添加 AI 提示框状态
    aiPromptVisible: false,
    aiPromptPosition: { top: 0, left: 0, width: 'auto' } as AiPromptPosition,
    aiPromptTargetBlockId: '',
    aiPromptTriggerPos: null as AiPromptTriggerPos,
    // 目录侧边栏显示状态
    outlineVisible: false,
    // 编辑器实例版本号。真实 editor 实例不能放进 Pinia state：
    // 大文档下任何 UI mutation 都可能被 Pinia/Vue Devtools 快照遍历，导致 renderer 卡死。
    editorInstanceVersion: 0,
    // 文件下拉菜单状态
    isFileDropdownOpen: false,
    // 导出设置模态框状态
    exportSettingsModalVisible: false,
    currentExportType: null as string | null, // 'txt', 'pdf', 'docx', etc.
    // ++ 新增：调试面板状态 ++
    debugPanelVisible: false,
    // ++ 在 State 中添加 sidebarWidth 状态 ++
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    outlineSidebarWidth: 240, // 默认大纲侧边栏宽度
    notificationPanelVisible: true,
    // 知识库模态框可见性
    isKnowledgeBaseModalVisible: false,
    // Drag and Drop state
    draggedOverItemId: null as string | null,

    // 布局过渡状态机（供动画等逻辑使用）
    isSidebarTransitioning: false,
    layoutTransitionSeq: 0,
    transitionStartedAt: 0,

    // 修订模式开关（文档级 Track Changes）
    revisionModeEnabled: false,
  }),
  
  actions: {
    // 切换侧边栏显示状态
    toggleSidebar() {
      const currentState = this.sidebarVisible;
      const newState = !currentState;
      this.sidebarVisible = newState;
    },

    /**
     * 设置左侧侧边栏显隐。
     * 中文说明：Header 按钮和设置面板都属于布局显隐入口，
     * 统一走这个 action，避免组件直接写入持久化状态。
     */
    setSidebarVisible(visible: boolean) {
      this.sidebarVisible = visible;
    },
    
    // 设置主题
    setTheme(theme: RendererUiTheme) {
      this.theme = theme;
    },
    
    // 切换设置模态窗口显示状态
    toggleSettingsModal() {
      if (this.settingsModalVisible) {
        this.closeSettingsModal();
        return;
      }
      this.openSettingsModal();
    },

    /**
     * 打开设置弹窗，并可选定位到指定 tab。
     *
     * 中文说明：
     * - tab 是否存在由 settings registry 决定；
     * - store 只记录“打开意图”，不直接依赖 settings domain 的内部组件。
     */
    openSettingsModal(initialTabId: string | null = null) {
      this.settingsInitialTabId = initialTabId;
      this.settingsModalVisible = true;
    },

    closeSettingsModal() {
      this.settingsModalVisible = false;
      this.settingsInitialTabId = null;
    },
    
    // 显示 AI 提示框 - 接收并存储 triggerPos
    showAiPrompt({
      position,
      targetBlockId,
      triggerPos,
    }: {
      position: AiPromptPosition
      targetBlockId: string
      triggerPos: AiPromptTriggerPos
    }) {
      console.log('[UIStore] Showing AI Prompt:', { position, targetBlockId, triggerPos });
      this.aiPromptVisible = true;
      this.aiPromptPosition = { ...position };
      this.aiPromptTargetBlockId = targetBlockId;
      this.aiPromptTriggerPos = triggerPos;
    },
    
    // 隐藏 AI 提示框 - 重置 triggerPos
    hideAiPrompt() {
      console.log('[UIStore] Hiding AI Prompt');
      this.aiPromptVisible = false;
      this.aiPromptTriggerPos = null;
    },

    // 新增：切换目录侧边栏显示状态
    toggleOutline() {
      console.log(`[UIStore] Outline visibility toggled: ${this.outlineVisible}`); 
      this.outlineVisible = !this.outlineVisible;
    },

    // 新增：设置编辑器实例
    setEditorInstance(editor: UiEditorInstance) {
      currentEditorInstance = editor ? markRaw(editor) : null;
      this.editorInstanceVersion += 1;
    },
    
    // 新增：获取编辑器实例
    getEditor() {
      // 让 computed(() => uiStore.getEditor()) 能跟随 setEditorInstance 失效。
      void this.editorInstanceVersion;
      return currentEditorInstance;
    },

    // +++ 新增：设置文件下拉菜单状态 +++
    setFileDropdownOpen(isOpen: boolean) {
      if (this.isFileDropdownOpen !== isOpen) {
        this.isFileDropdownOpen = isOpen;
      }
    },
    
    // ++ 新增：设置导出设置模态框可见性和类型 ++
    setExportSettingsVisible(visible: boolean, type: string | null = null) {
      console.log(`[UIStore] Setting export settings visibility: ${visible}, type: ${type}`);
      this.exportSettingsModalVisible = visible;
      // 只有在打开模态框时才设置类型，关闭时重置
      this.currentExportType = visible ? type : null;
    },
    
    // ++ 新增：切换调试面板可见性 ++
    toggleDebugPanel() {
      console.log(`[UIStore] Toggling debug panel visibility. Current: ${this.debugPanelVisible}`);
      this.debugPanelVisible = !this.debugPanelVisible;
    },

    // ++ 在 Actions 中添加 setSidebarWidth 方法 ++
    setSidebarWidth(newWidth: number) {
      this.sidebarWidth = clampSidebarWidth(newWidth);
    },

    normalizeSidebarWidth() {
      this.sidebarWidth = clampSidebarWidth(this.sidebarWidth);
    },

    // Drag and Drop actions
    setDraggedOverItemId(itemId: string | null) {
      this.draggedOverItemId = itemId;
    },

    // 🔥 清理：移除不再需要的布局过渡状态管理
    // markLayoutTransitionStart() { ... },
    // markLayoutTransitionEnd() { ... },

    // ==================== 修订模式相关 Actions ====================

    /**
     * 启用修订模式
     * - 后续所有编辑操作将尝试以“修订”的形式记录（使用 RevisionMark 标记插入）
     */
    enableRevisionMode() {
      if (!this.revisionModeEnabled) {
        console.log('[UIStore] 启用修订模式');
        this.revisionModeEnabled = true;
      }
    },

    /**
     * 禁用修订模式
     */
    disableRevisionMode() {
      if (this.revisionModeEnabled) {
        console.log('[UIStore] 禁用修订模式');
        this.revisionModeEnabled = false;
      }
    },

    /**
     * 切换修订模式
     */
    toggleRevisionMode() {
      this.revisionModeEnabled = !this.revisionModeEnabled;
      console.log('[UIStore] 切换修订模式:', this.revisionModeEnabled);
    },

  },

  persist: {
    key: 'ui-settings',
    storage: getRendererPersistStorage(),
    pick: ['theme', 'sidebarVisible', 'sidebarWidth', 'revisionModeEnabled'],
  }
})
