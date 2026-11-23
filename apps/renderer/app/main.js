// src/renderer/main.js

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import './styles/index.css'
import './layout/styles/index.css'
import './pages/styles/index.css'
import './update/styles/index.css'
import './backend-health/styles/index.css'
import './plugins/styles/RendererPluginLoadFailureNotice.css'
import '../domains/editor/styles/index.css'
import '../domains/settings/styles/index.css'
import '../domains/skills/styles/index.css'
import '../domains/conversation/styles/index.css'
import '../domains/workspace/styles/index.css'
import '../domains/plugin-store/styles/index.css'
import '../domains/editor/features/floating-toolbar/styles/FloatingToolbar.css'
import '../domains/editor/features/floating-toolbar/styles/TextSelectionToolbar.css'
import '../domains/editor/features/citation/ui/styles/WebManualCitationForm.css'
// KaTeX 基础样式（会话侧自研渲染层使用 renderToString 输出的 DOM 结构）
import 'katex/dist/katex.min.css'
// KaTeX 扩展：支持 \ce{ } 化学公式（mhchem 会在运行时向 katex 注册宏）
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
import { ensureBackendHealthLocalizationRegistered, startBackendHealthLifecycle } from './backend-health'
import { ensureSystemLocalizationRegistered } from './system/orchestration/ensureSystemLocalizationRegistered'
import { ensurePluginStoreLocalizationRegistered } from '../domains/plugin-store/orchestration/ensurePluginStoreLocalizationRegistered'
import { ensureWorkspaceLocalizationRegistered } from '../domains/workspace/orchestration/ensureWorkspaceLocalizationRegistered'
import { ensureConversationLocalizationRegistered } from '../domains/conversation/registrations/ensureConversationLocalizationRegistered'
import { ensureConversationObservabilityRegistered } from '../domains/conversation/registrations/ensureConversationObservabilityRegistered'
import { ensureEditorLocalizationRegistered } from '../domains/editor/orchestration/ensureEditorLocalizationRegistered'
import { ensurePluginContributionLocalizationRegistered } from './plugins/orchestration/ensurePluginContributionLocalizationRegistered'
import { ensureRendererPluginLoadLocalizationRegistered } from './plugins/orchestration/ensureRendererPluginLoadLocalizationRegistered'
import { ensureTableFillLocalizationRegistered } from './workflows/table-fill/orchestration/ensureTableFillLocalizationRegistered'
import { ensureDocumentPreviewLocalizationRegistered } from './workflows/document-preview/orchestration/ensureDocumentPreviewLocalizationRegistered'
import { provideHoverTooltipWindowFocus } from './orchestration/provideHoverTooltipWindowFocus'
import { startNotificationAutoDismissal } from './notification'
import { useUIStore } from '../../../apps/renderer/shared/stores/ui'
import {
  startModelCatalogLifecycle,
  startModelPickerLifecycle,
} from '../domains/model-configuration'
import { syncScheduledDefaultModel } from './model-inference/orchestration/syncScheduledDefaultModel'
import { startScheduledNotificationNavigation } from './workflows/scheduled-tasks/orchestration/startScheduledNotificationNavigation'
import { startConversationActivityLifecycle } from '../domains/conversation/features/conversation-activity'
import { useUpdateActions } from './update/runtime'

const conversationFixtureId = import.meta.env.DEV
  ? new window.URLSearchParams(window.location.search).get('fixture')
  : null
const isConversationFixture = conversationFixtureId === 'conversation-virtualizer-spike'
  || conversationFixtureId === 'conversation-visual-row'
  || conversationFixtureId === 'conversation-image-attachments'
  || conversationFixtureId === 'command-approval-dom'
  || conversationFixtureId === 'conversation-execution-notice'
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
const executionNoticeFixture = conversationFixtureId === 'conversation-execution-notice'
  ? await import('./fixtures/conversation-execution-notice')
  : null
const rootComponent = conversationFixtureId === 'conversation-virtualizer-spike'
  ? conversationVirtualizerFixtures.ConversationVirtualizerSpikePage
  : conversationFixtureId === 'conversation-visual-row'
    ? conversationVirtualizerFixtures.ConversationVisualRowFixturePage
    : conversationFixtureId === 'conversation-image-attachments'
      ? conversationImageAttachmentFixtures.ConversationImageAttachmentFixturePage
      : conversationFixtureId === 'command-approval-dom'
        ? commandApprovalDomFixture.CommandApprovalDomFixturePage
        : conversationFixtureId === 'conversation-execution-notice'
          ? executionNoticeFixture.ConversationExecutionNoticeFixturePage
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
ensureBackendHealthLocalizationRegistered()
ensureSystemLocalizationRegistered()
if (import.meta.env.DEV) {
  void import('./system/features/process-memory-observation').then(({ ensureProcessMemoryObservationRegistered }) => {
    ensureProcessMemoryObservationRegistered()
  })
}
ensurePluginStoreLocalizationRegistered()
ensureWorkspaceLocalizationRegistered()
ensureConversationLocalizationRegistered()
ensureEditorLocalizationRegistered()
ensurePluginContributionLocalizationRegistered()
ensureRendererPluginLoadLocalizationRegistered()
ensureTableFillLocalizationRegistered()
ensureDocumentPreviewLocalizationRegistered()

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
  startModelCatalogLifecycle().then(() => {
    app.onUnmount(syncScheduledDefaultModel())
  }).catch(error => {
    console.warn('[App] 预加载模型列表失败，将在需要时重试:', error)
  })
  startModelPickerLifecycle().catch(error => {
    console.error('[main] 模型选择器初始化失败:', error)
  })
  // 后台服务停止、重启或卡住：Main 唯一持有状态，这里只订阅快照。
  startBackendHealthLifecycle()
  // 侧栏运行状态：先订阅 App Server 的失效信号，再读一次全工作区状态。
  startConversationActivityLifecycle()

}

/**
 * 应用更新状态由 Main 唯一持有：先挂好状态监听并读取当前快照，再发 renderer-ready。
 * 只有 Main 已验真的 official 发行身份会开始后台检查；source/community 仍需要
 * renderer-ready 完成其他 App 生命周期订阅，不能在 Renderer 自行猜发行身份。
 */
if (!isConversationFixture) {
  void useUpdateActions().connect()
}

app.mount('#app')

if (!isConversationFixture) {
  const dispose = startScheduledNotificationNavigation()
  if (dispose) app.onUnmount(dispose)
}

// 更新状态监听已注册后通知主进程 ready；是否检查更新由 Main 的发行身份决定。
if (
  !isConversationFixture
  && window.electronAPI
  && typeof window.electronAPI.invoke === 'function'
) {
  window.electronAPI.invoke('renderer-ready')
}
