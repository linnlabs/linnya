// src/renderer/main.js

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import './styles/index.css'
import './layout/styles/index.css'
import './pages/styles/index.css'
import './update/styles/index.css'
import '../domains/editor/styles/index.css'
import '../domains/settings/styles/index.css'
import '../domains/conversation/styles/index.css'
import '../domains/workspace/styles/index.css'
import '../domains/knowledgebase/styles/index.css'
import '../domains/plugin-store/styles/index.css'
import '../domains/editor/features/floating-toolbar/styles/FloatingToolbar.css'
import '../domains/editor/features/floating-toolbar/styles/TextSelectionToolbar.css'
import '../domains/editor/features/citation/ui/styles/WebManualCitationForm.css'
// KaTeX 基础样式（会话侧自研渲染层使用 renderToString 输出的 DOM 结构）
import 'katex/dist/katex.min.css'
// KaTeX 扩展：支持 \ce{ } 化学公式（mhchem 会在运行时向 katex 注册宏）
// eslint-disable-next-line import/no-unassigned-import
import 'katex/contrib/mhchem'
import VueKonva from 'vue-konva'
import App from './App.vue'
// 导入注册自动高度指令的函数
import { registerAutoResizeDirective } from '../domains/editor/features/Annotation/utils/autoResize';
import {
  ensureEditorDocumentSettingsContributionRegistered,
  migrateLegacyEditorDocumentSettings,
} from '../domains/editor/features/DocumentSettings';
import { ensureCoreSettingsContributionsRegistered } from '../domains/settings/registry/registerCoreSettingsContributions';
import {
  applyThemeToDom,
  normalizeStoredTheme,
} from './layout/functions/themeClassManagement'
import { ensureLayoutLocalizationRegistered } from './layout/orchestration/ensureLayoutLocalizationRegistered'
import { initializeLocalization } from './localization'
import {
  ensureSharedComponentLocalizationRegistered,
  provideSharedComponentLocalization,
} from './localization/orchestration/provideSharedComponentLocalization'
import { ensureUpdateLocalizationRegistered } from './update/orchestration/ensureUpdateLocalizationRegistered'
import { ensureSystemLocalizationRegistered } from './system/orchestration/ensureSystemLocalizationRegistered'
import { ensurePluginStoreLocalizationRegistered } from '../domains/plugin-store/orchestration/ensurePluginStoreLocalizationRegistered'
import { ensureWorkspaceLocalizationRegistered } from '../domains/workspace/orchestration/ensureWorkspaceLocalizationRegistered'
import { ensureKnowledgeBaseLocalizationRegistered } from '../domains/knowledgebase/orchestration/ensureKnowledgeBaseLocalizationRegistered'
import { registerKnowledgeBaseModelConfigurationPorts } from '../domains/knowledgebase/registrations/registerModelConfigurationPorts'
import { ensureConversationLocalizationRegistered } from '../domains/conversation/registrations/ensureConversationLocalizationRegistered'
import { ensureConversationObservabilityRegistered } from '../domains/conversation/registrations/ensureConversationObservabilityRegistered'
import { ensureEditorLocalizationRegistered } from '../domains/editor/orchestration/ensureEditorLocalizationRegistered'
import { ensurePluginContributionLocalizationRegistered } from './plugins/orchestration/ensurePluginContributionLocalizationRegistered'
import { ensureTableFillLocalizationRegistered } from './workflows/table-fill/orchestration/ensureTableFillLocalizationRegistered'
import { provideHoverTooltipWindowFocus } from './orchestration/provideHoverTooltipWindowFocus'
import { startNotificationAutoDismissal } from './notification'
import { useUIStore } from '../../../apps/renderer/shared/stores/ui'
import {
  startModelCatalogLifecycle,
  startModelPickerLifecycle,
} from '../domains/model-configuration'
import { useKnowledgeBaseStore } from '../domains/knowledgebase/stores/knowledgeBase'
import { useUpdateStore } from './update/store/updateStore'

const conversationFixtureId = import.meta.env.DEV
  ? new window.URLSearchParams(window.location.search).get('fixture')
  : null
const isConversationFixture = conversationFixtureId === 'conversation-virtualizer-spike'
  || conversationFixtureId === 'conversation-visual-row'
  || conversationFixtureId === 'conversation-image-attachments'
  || conversationFixtureId === 'command-approval-dom'
const conversationVirtualizerFixtures = conversationFixtureId === 'conversation-virtualizer-spike'
  || conversationFixtureId === 'conversation-visual-row'
  ? await import('../domains/conversation/features/virtualizer-spike')
  : null
const conversationImageAttachmentFixtures = conversationFixtureId === 'conversation-image-attachments'
  ? await import('../domains/conversation/features/image-attachments')
  : null
const commandApprovalDomFixture = conversationFixtureId === 'command-approval-dom'
  ? await import('./fixtures/command-approval-dom')
  : null
const rootComponent = conversationFixtureId === 'conversation-virtualizer-spike'
  ? conversationVirtualizerFixtures.ConversationVirtualizerSpikePage
  : conversationFixtureId === 'conversation-visual-row'
    ? conversationVirtualizerFixtures.ConversationVisualRowFixturePage
    : conversationFixtureId === 'conversation-image-attachments'
      ? conversationImageAttachmentFixtures.ConversationImageAttachmentFixturePage
      : conversationFixtureId === 'command-approval-dom'
        ? commandApprovalDomFixture.CommandApprovalDomFixturePage
        : App

const app = createApp(rootComponent)
const pinia = createPinia()
pinia.use(createPersistedState({ debug: true }))

ensureCoreSettingsContributionsRegistered()
ensureEditorDocumentSettingsContributionRegistered()
migrateLegacyEditorDocumentSettings()
ensureLayoutLocalizationRegistered()
ensureSharedComponentLocalizationRegistered()
ensureUpdateLocalizationRegistered()
ensureSystemLocalizationRegistered()
if (import.meta.env.DEV) {
  void import('./system/features/process-memory-observation').then(({ ensureProcessMemoryObservationRegistered }) => {
    ensureProcessMemoryObservationRegistered()
  })
}
ensurePluginStoreLocalizationRegistered()
ensureWorkspaceLocalizationRegistered()
ensureKnowledgeBaseLocalizationRegistered()
registerKnowledgeBaseModelConfigurationPorts()
ensureConversationLocalizationRegistered()
ensureEditorLocalizationRegistered()
ensurePluginContributionLocalizationRegistered()
ensureTableFillLocalizationRegistered()

app.use(pinia)
app.onUnmount(startNotificationAutoDismissal())
if (conversationFixtureId === 'conversation-visual-row') {
  const { installConversationVisualRowFixtureHost } = await import(
    './fixtures/orchestration/installConversationVisualRowFixtureHost'
  )
  installConversationVisualRowFixtureHost()
}
ensureConversationObservabilityRegistered()
app.use(VueKonva)
provideSharedComponentLocalization(app)
provideHoverTooltipWindowFocus(app)
initializeLocalization({ document })
// 注册自动高度指令
registerAutoResizeDirective(app);

// 提供全局引用
window.__APP_INSTANCE__ = app

// 确保 uiStore 被初始化
const uiStore = useUIStore()
const initialTheme = normalizeStoredTheme(uiStore.theme)
applyThemeToDom(initialTheme, {
  root: document.documentElement,
  body: document.body,
})
if (initialTheme !== uiStore.theme) {
  uiStore.setTheme(initialTheme)
}
app.config.globalProperties.$uiStore = uiStore

if (!isConversationFixture) {
  // 夹具不启动业务后台任务，避免模型请求、知识库请求和 SSE 干扰逐帧测量。
  startModelCatalogLifecycle().catch(error => {
    console.warn('[App] 预加载模型列表失败，将在需要时重试:', error)
  })
  startModelPickerLifecycle().catch(error => {
    console.error('[main] 模型选择器初始化失败:', error)
  })

  const knowledgeBaseStore = useKnowledgeBaseStore()
  knowledgeBaseStore.fetchKnowledgeBases().catch(error => {
    console.warn('[App] 预加载知识库列表失败，将在需要时重试:', error)
  })
}

/**
 * 更新弹窗稳定性：尽可能早地注册 update-message 监听器，并在监听器就绪后通知主进程开始检查。
 *
 * 需求（中文）：
 * - 开发环境：不管是否有更新，都要弹（至少展示 checking/已是最新版本）
 * - 生产环境：只有有更新才弹；发生错误也要弹
 *
 * 根因（中文）：
 * - 如果主进程在窗口/监听器就绪前发送 update-message，渲染进程会漏收，从而“不弹窗”。
 * - 通过 renderer-ready 握手触发 checkForUpdates，保证消息不会丢。
 */
if (!isConversationFixture) {
  const updateStore = useUpdateStore()
  if (window.electronAPI && typeof window.electronAPI.onUpdateMessage === 'function') {
    window.electronAPI.onUpdateMessage(({ channel, payload }) => {
      updateStore.handleIpc(channel, payload)
    })
  }
}

app.mount('#app')

// 监听器已注册后，再通知主进程：渲染进程 ready，可以开始自动检查更新
if (
  !isConversationFixture
  && window.electronAPI
  && typeof window.electronAPI.invoke === 'function'
) {
  window.electronAPI.invoke('renderer-ready')
}
