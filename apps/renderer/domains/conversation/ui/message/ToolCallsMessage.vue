<template>
  <!-- 0. 有明确修复动作的错误：单层展示，避免再套一层无意义的展开。 -->
  <div
    v-if="status === 'error' && toolErrorAction"
    class="tool-calls-message tool-card tool-error-wrapper"
  >
    <ToolErrorCard
      :errorMessage="toolErrorMessage"
      :actionLabel="toolErrorActionLabel"
      @action="handleToolErrorAction"
    />
  </div>

  <!-- 0.1 普通错误：默认折叠；点击 Header 后直接展示真实错误。 -->
  <div v-else-if="status === 'error'" class="tool-calls-message tool-card tool-error-wrapper">
    <div class="tool-card__header" @click="toggleErrorCollapse">
      <div class="tool-card__title">
        <span class="tool-card__name">
          {{ conversationMessage('conversation.tool.error.title', { toolName }) }}
        </span>
      </div>
      <div class="header-controls">
        <ChevronIcon
          :direction="isErrorCollapsed ? 'down' : 'up'"
          class="collapse-icon"
        />
      </div>
    </div>
    <div class="tool-card__content" v-show="!isErrorCollapsed">
      <ToolErrorCard :errorMessage="toolErrorMessage" />
    </div>
  </div>

  <template v-else>
  <!-- 1. 注册表优先模式 (Registry Mode) -->
  <!-- 如果在前端注册表中找到了该工具的配置，完全接管渲染 -->
  <!-- 1.1 “分组模式”：不渲染外层 tool-card，让工具组件自己以 UiCardGroup 等方式呈现 -->
  <div v-if="registryConfig && isRegistryRenderAsGroup" class="tool-calls-message tool-group-mode">
    <template v-if="shouldMountRegistryComponent">
      <component
        v-if="toolPresentation"
        :is="registryConfig.component"
        :presentation="toolPresentation"
        :messageId="message.id"
        v-bind="presentationRuntimeBindings"
      />
      <component
        v-else
        :is="registryConfig.component"
        :args="toolArgs"
        :result="toolResult"
        :status="status"
        :messageId="message.id"
        :subrunTrace="subrunTrace"
        :subrunTraceVersion="subrunTraceVersion"
        v-bind="{
          toolCallId: canonicalToolCallId,
          messageMetadata: message.metadata,
          conversationId: conversationRenderScope.conversationId,
          lazySubrunTraceSource: historicalSubrunTraceSource,
        }"
      />
    </template>
  </div>

  <div v-else-if="registryConfig" class="tool-calls-message tool-registry-card" :class="registryCardClasses">
    <!-- 可选标题栏 (由前端配置决定) -->
    <div 
      v-if="registryTitleText" 
      class="tool-card__header"
      :class="{
        'tool-card__header--static': !canToggleRegistryCollapse,
        'tool-card__header--no-hover': shouldDisableRegistryHeaderHover,
      }"
      @click="canToggleRegistryCollapse && toggleCollapse()"
    >
      <div class="tool-card__title">
        <!-- 图标 (前端配置) -->
        <component
          v-if="registryIconComponent"
          :is="registryIconComponent"
          class="tool-card__icon"
        />
        <!-- 标题 (前端动态生成) -->
          <span class="tool-card__name">
          <!-- 可选标签：例如「新建」「调试」 -->
          <span
            v-if="registryTitleTag"
            class="tool-card__tag"
            :class="`tool-card__tag--${registryTitleTag.variant || 'default'}`"
          >
            {{ registryTitleTag.text }}
          </span>
          <span
            v-if="registryTitleDocumentLink"
            class="tool-card__name-text tool-card__name-text--document-link"
          >
            <span class="tool-card__title-prefix">{{ registryTitleDocumentLink.prefixText }}</span>
            <button
              type="button"
              class="tool-card__title-link"
              @click.stop="handleRegistryTitleDocumentClick(registryTitleDocumentLink)"
            >
              {{ registryTitleDocumentLink.text }}
            </button>
          </span>
          <component
            v-else-if="registryConfig.titleComponent"
            :is="registryConfig.titleComponent"
            class="tool-card__name-text"
            :fallback-title="registryTitleMainText || registryTitleText"
            :status="status"
            v-bind="presentationRuntimeBindings"
          />
          <span v-else class="tool-card__name-text">
            {{ registryTitleMainText || registryTitleText }}
          </span>
          <span
            v-if="registryTitleRightMeta"
            class="tool-card__header-meta"
          >
            {{ registryTitleRightMeta }}
          </span>
        </span>
      </div>
      
      <div class="header-controls">
        <div
          v-if="isLoading && !hasContent && !isKnowledgeSearchTool && !registryConfig.titleComponent"
          class="tool-card__loading"
        >
          <div class="loading-spinner"></div>
        </div>
        <ChevronIcon 
          v-if="canToggleRegistryCollapse"
          :direction="isCollapsed ? 'down' : 'up'"
          class="collapse-icon"
        />
      </div>
    </div>

    <!-- 内容区域 (前端组件) -->
    <div
      v-if="shouldMountRegistryComponent"
      class="tool-card__content"
      :class="registryContentClasses"
      v-show="shouldShowRegistryContent"
    >
      <component
        v-if="toolPresentation"
        :is="registryConfig.component"
        :presentation="toolPresentation"
        :messageId="message.id"
        v-bind="presentationRuntimeBindings"
      />
      <component
        v-else
        :is="registryConfig.component"
        :args="toolArgs"
        :result="toolResult"
        :status="status"
        :messageId="message.id"
        :subrunTrace="subrunTrace"
        :subrunTraceVersion="subrunTraceVersion"
        v-bind="{
          toolCallId: canonicalToolCallId,
          messageMetadata: message.metadata,
          conversationId: conversationRenderScope.conversationId,
          lazySubrunTraceSource: historicalSubrunTraceSource,
        }"
      />
    </div>
  </div>

  <!-- 2. 通用诊断模式：仅承接未知工具、插件未加载或注册异常；正式工具必须注册自己的 UI。 -->
  <div v-else class="tool-calls-message tool-card" :class="{ 'is-collapsed': isCollapsed }">
    <div class="tool-card__header" @click="hasContent && toggleCollapse()">
      <div class="tool-card__title">
        <span class="tool-card__name">
          {{ toolName }}
        </span>
      </div>

      <div class="header-controls">
        <div
          v-if="isLoading && !hasContent && !isKnowledgeSearchTool"
          class="tool-card__loading"
        >
          <div class="loading-spinner"></div>
        </div>
        <ChevronIcon
          v-if="hasContent"
          :direction="isCollapsed ? 'down' : 'up'"
          class="collapse-icon"
        />
      </div>
    </div>

    <div v-if="hasContent" v-show="!isCollapsed" class="tool-card__content">
      {{ message.content }}
    </div>
  </div>
  </template>
</template>

<script setup lang="ts">
import { computed, inject, ref, toRef, watch } from 'vue';
import type { ToolCallMessage } from '../../types';
import { useToolMessageCore } from './toolCallsMessage/useToolMessageCore';
import { useRegistryToolUi } from './toolCallsMessage/useRegistryToolUi';
import { createToolCardCollapseState, useToolCardCollapseEffects } from './toolCallsMessage/useToolCardCollapse';
import ToolErrorCard from './toolCallsMessage/ToolErrorCard.vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { projectToolErrorMessage } from './toolCallsMessage/toolMessageMeta.ts';
import { useRegisteredRendererToolRefreshTriggers } from '@plugin/renderer/toolRefreshPort';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useNotificationStore } from '@/app/notification';
import type { ToolTitleConfig } from '../tools/types';
import { useAssistantStore } from '../../store/assistantStore';
import { useConversationLocalization } from '../useConversationLocalization';
import type { HistoricalSubrunTraceLazySource } from '../../features/subrun-trace';
import { SUBRUN_TRACE_STEP_KINDS } from '../../features/subrun-trace';
import { useLocalization } from '@app/localization';
import { buildToolPresentationRuntimeBindings } from './toolCallsMessage/buildToolPresentationRuntimeBindings';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../definitions/conversationRenderScope';
import { projectToolErrorAction } from '../../features/tool-error-actions/functions/projectToolErrorAction';
import { useUIStore } from '@/shared/stores/ui';

const props = defineProps<{
  message: ToolCallMessage;
}>();

// 说明：ToolCallsMessage 是通用组件，禁止保留临时 console 调试日志，避免污染用户控制台。

const messageRef = toRef(props, 'message');
const navigation = getWorkspaceNavigationPort();
const notificationStore = useNotificationStore();
const assistantStore = useAssistantStore();
const uiStore = useUIStore();
const conversationRenderScope = inject(CONVERSATION_RENDER_SCOPE_KEY);
if (!conversationRenderScope) {
  throw new Error('ConversationRenderScope 未装配：ToolCallsMessage 必须由 ConversationView 渲染');
}
const { conversationMessage } = useConversationLocalization();
const { t: resolveLocalizedText } = useLocalization();

/**
 * 错误卡片折叠（与普通 tool-card 的折叠分离）
 * - 诉求：错误信息通常很长，默认收起降低噪音
 * - 约束：不影响 registry 与通用工具卡的折叠策略
 */
const isErrorCollapsed = ref(true);
const toggleErrorCollapse = () => {
  isErrorCollapsed.value = !isErrorCollapsed.value;
};
// 1) 核心数据：解析 message.metadata
const { toolCallId, toolName, toolArgs, toolResult, status, isLoading, hasContent, subrunTrace, subrunTraceVersion } =
  useToolMessageCore(messageRef);
const toolPresentation = computed(() => props.message.toolPresentation);

// 1.5) 插件工具刷新触发器
// 中文说明：通用消息组件只广播工具状态，具体插件在 SDK registry 内自行判断是否刷新。
useRegisteredRendererToolRefreshTriggers({
  toolName,
  toolArgs,
  toolResult,
  status,
  messageId: computed(() => props.message.id),
  conversationId: computed(() => conversationRenderScope.conversationId),
});

/**
 * 知识库搜索工具（前端 UI 语义）
 *
 * - `search_in_knowledgebase` 是后端为了“不给子 Agent 暴露 deep_search 参数”而提供的等价浅搜索工具名；
 * - 但前端如果只识别 canonical `knowledge_search`，会导致：
 *   - registry 标题/执行中固定文案不生效；
 *   - header loading spinner 的特殊策略不生效；
 *   - 深度搜索完成后自动收起等策略无法复用（即使当前是浅搜索，也会影响一致性）。
 *
 * 约束：这里只做明确的工具名集合，不做任何推测。
 */
const isKnowledgeSearchTool = computed(() => {
  const n = toolName.value;
  return (
    n === 'knowledge_search' ||
    n === 'search_knowledge_base' ||
    n === 'search_in_knowledgebase' ||
    n === 'search_in_knowledge_base'
  );
});
// 2) 折叠 state（先创建 state，避免与 registry computed 形成依赖环）
const collapseState = createToolCardCollapseState();
const isCollapsed = collapseState.isCollapsed;
const toggleCollapse = collapseState.toggleCollapse;

// 3) registry 相关 computed
const registryUi = useRegistryToolUi({
  toolName,
  toolArgs,
  toolResult,
  toolPresentation,
  isLoading,
  isKnowledgeSearchTool,
  isCollapsed,
  conversationMessage,
  resolveLocalizedText,
});

const {
  registryConfig,
  isRegistryRenderAsGroup,
  registryTitleText,
  registryTitleTag,
  registryTitleMainText,
  registryTitleRightMeta,
  registryTitleDocumentLink,
  shouldDisableRegistryHeaderHover,
  registryCardClasses,
  registryContentClasses,
  shouldShowRegistryContent,
  shouldMountRegistryComponent,
  canToggleRegistryCollapse,
  registryDefaultCollapsed,
} = registryUi;

function handleRegistryTitleDocumentClick(link: NonNullable<ToolTitleConfig['documentLink']>): void {
  void navigation.openDocument({
    documentId: link.documentId,
    type: link.documentType,
    projectId: link.projectId ?? null,
    displayName: link.displayName ?? link.text,
    parentId: link.parentId ?? null,
  }).catch((error: unknown) => {
    console.error('[ToolCallsMessage] 打开工具关联文档失败:', error);
    notificationStore.show(conversationMessage('conversation.tool.error.openDocumentFailedGeneric'), 'error', 3000);
  });
}

const toolErrorAction = computed(() => projectToolErrorAction(props.message.metadata.error_code));
const toolErrorMessage = computed(() => {
  const action = toolErrorAction.value;
  if (action) return conversationMessage(action.messageKey);
  return projectToolErrorMessage({
    toolResult: toolResult.value,
    observation: props.message.content,
    fallback: conversationMessage('conversation.tool.error.unknown'),
  });
});
const toolErrorActionLabel = computed(() => {
  const action = toolErrorAction.value;
  return action ? conversationMessage(action.actionLabelKey) : undefined;
});

function handleToolErrorAction(): void {
  const action = toolErrorAction.value;
  if (action) uiStore.openSettingsModal(action.settingsTabId);
}

watch(
  () => props.message.id,
  () => {
    // 组件复用到另一条普通错误消息时，不能继承上一条消息的展开状态。
    isErrorCollapsed.value = true;
  },
);

const canonicalToolCallId = computed(() => {
  return toolCallId.value;
});

const historicalSubrunTraceSource = computed<HistoricalSubrunTraceLazySource | undefined>(() => {
  const conversationId = conversationRenderScope.conversationId;
  const parentToolCallId = canonicalToolCallId.value;
  const meta = props.message.metadata;
  if (!conversationId || !parentToolCallId) return undefined;
  // run_id 已由 ConversationToolMessageMetadataSchema 保证；render scope 才是读取归属身份。
  return {
    conversationId,
    parentToolCallId,
    kinds: SUBRUN_TRACE_STEP_KINDS,
  };
});

/** 已迁移卡片只获得 registry 显式声明的运行期事实，禁止默认暴露整份 message/store。 */
const presentationRuntimeBindings = computed(() => ({
  ...buildToolPresentationRuntimeBindings({
    capabilities: registryConfig.value?.runtime,
    conversationId: conversationRenderScope.conversationId,
    parentToolCallId: canonicalToolCallId.value,
    subrunTrace: subrunTrace.value,
    subrunTraceVersion: subrunTraceVersion.value,
    historicalSubrunTraceSource: historicalSubrunTraceSource.value,
    attachments: props.message.attachments,
  }),
}));

// 5) 折叠 effects：初始化、深度搜索、ToDo 自动收起（在拿到标题/默认规则后挂载）
useToolCardCollapseEffects(collapseState, {
  message: messageRef,
  toolName,
  toolArgs,
  status,
  isKnowledgeSearchTool,
  registryTitleText,
  registryDefaultCollapsed,
  latestTodoToolMessageId: computed(() => assistantStore.latestTodoToolMessageId),
});

// 注册表模式下的图标
const registryIconComponent = computed(() => {
  return registryConfig.value?.icon ?? null;
});

</script>
