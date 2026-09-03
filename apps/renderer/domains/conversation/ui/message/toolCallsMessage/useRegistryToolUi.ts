/**
 * @file useRegistryToolUi.ts
 * @description ToolCallsMessage 的 registry 渲染相关 computed（标题、布局、挂载策略等）。
 */

import { computed, type ComputedRef, type Ref } from 'vue';
import { readToolUiConfigByKey, resolveToolUiConfig } from '../../tools/registry';
import type { ConversationMessageResolver } from '../../../definitions/conversationMessages';
import type {
  ToolCardPresentation,
  ToolLocalizedTextDescriptor,
  ToolTitleConfig,
  ToolUiConfig,
} from '../../tools/types';
import { isRecord } from '../../../utils/typeGuards';
import { resolveToolTitleDescriptor } from '../../tools/functions/resolveToolTitleDescriptor';

export interface UseRegistryToolUiParams {
  toolName: ComputedRef<string>;
  toolArgs: ComputedRef<Record<string, unknown>>;
  toolResult: ComputedRef<unknown>;
  toolPresentation: ComputedRef<ToolCardPresentation | undefined>;
  isLoading: ComputedRef<boolean>;
  isKnowledgeSearchTool: ComputedRef<boolean>;
  isCollapsed: Ref<boolean>;
  conversationMessage: ConversationMessageResolver;
  resolveLocalizedText: (text: ToolLocalizedTextDescriptor) => string;
}

export interface RegistryToolUiModel {
  registryConfig: ComputedRef<ToolUiConfig | null>;
  isRegistryRenderAsGroup: ComputedRef<boolean>;

  rawRegistryTitle: ComputedRef<unknown | null>;
  registryTitleText: ComputedRef<string | null>;
  registryTitleTag: ComputedRef<{ text: string; variant?: string } | null>;
  registryTitleMainText: ComputedRef<string | null>;
  registryTitleRightMeta: ComputedRef<string | null>;
  registryTitleDocumentLink: ComputedRef<ToolTitleConfig['documentLink'] | null>;
  shouldDisableRegistryHeaderHover: ComputedRef<boolean>;

  registryCardClasses: ComputedRef<Record<string, boolean>>;
  registryContentClasses: ComputedRef<Record<string, boolean>>;

  shouldShowRegistryContent: ComputedRef<boolean>;
  shouldMountRegistryComponent: ComputedRef<boolean>;
  canToggleRegistryCollapse: ComputedRef<boolean>;

  registryDefaultCollapsed: ComputedRef<boolean | ((args: Record<string, unknown>) => boolean) | undefined>;
}

export function useRegistryToolUi(params: UseRegistryToolUiParams): RegistryToolUiModel {
  const {
    toolName,
    toolArgs,
    toolResult,
    toolPresentation,
    isLoading,
    isKnowledgeSearchTool,
    isCollapsed,
    conversationMessage,
    resolveLocalizedText,
  } = params;

  const registryConfig = computed(() => {
    const presentation = toolPresentation.value;
    return presentation
      ? readToolUiConfigByKey(presentation.uiKey)
      : resolveToolUiConfig(toolName.value, toolArgs.value, toolResult.value);
  });

  const isRegistryRenderAsGroup = computed(() => {
    const layout = registryConfig.value?.layout;
    return !!layout && layout.renderAsGroup === true;
  });

  const rawRegistryTitle = computed<unknown | null>(() => {
    // UX：知识库搜索执行中，header 固定文案，避免与内容区 trace 重复
    if (isKnowledgeSearchTool.value && isLoading.value) {
      return conversationMessage('conversation.tool.registry.knowledgeSearching');
    }

    if (toolPresentation.value?.title) {
      return resolveToolTitleDescriptor(toolPresentation.value.title, resolveLocalizedText);
    }
    return null;
  });

  const registryTitleText = computed<string | null>(() => {
    const t = rawRegistryTitle.value;
    if (!t) return null;
    if (typeof t === 'string') return t;
    if (!isRecord(t)) return null;
    return typeof t.text === 'string' ? t.text : null;
  });

  const registryTitleTag = computed<{ text: string; variant?: string } | null>(() => {
    const t = rawRegistryTitle.value;
    if (!t || typeof t === 'string') return null;
    if (!isRecord(t)) return null;
    const tag = t.tag;
    if (!isRecord(tag)) return null;
    if (typeof tag.text !== 'string' || tag.text.length === 0) return null;
    const variant = typeof tag.variant === 'string' ? tag.variant : undefined;
    return { text: tag.text, variant };
  });

  const registryTitleMainText = computed<string | null>(() => {
    const text = registryTitleText.value;
    if (!text) return null;
    return text;
  });

  const registryTitleRightMeta = computed<string | null>(() => {
    return null;
  });

  const registryTitleDocumentLink = computed<ToolTitleConfig['documentLink'] | null>(() => {
    const t = rawRegistryTitle.value;
    if (!t || typeof t === 'string') return null;
    if (!isRecord(t)) return null;
    const link = t.documentLink;
    if (!isRecord(link)) return null;
    if (
      typeof link.prefixText !== 'string' ||
      typeof link.text !== 'string' ||
      typeof link.documentId !== 'string' ||
      typeof link.documentType !== 'string'
    ) {
      return null;
    }
    return {
      prefixText: link.prefixText,
      text: link.text,
      documentId: link.documentId,
      documentType: link.documentType,
      ...(typeof link.displayName === 'string' ? { displayName: link.displayName } : {}),
      ...(typeof link.projectId === 'string' || link.projectId === null ? { projectId: link.projectId } : {}),
      ...(typeof link.parentId === 'string' || link.parentId === null ? { parentId: link.parentId } : {}),
    };
  });

  const registryDefaultCollapsed = computed(() => registryConfig.value?.layout?.defaultCollapsed);

  const shouldDisableRegistryHeaderHover = computed(() => {
    return registryConfig.value?.layout?.disableHeaderHover === true;
  });

  const registryCardClasses = computed(() => {
    const layout = registryConfig.value?.layout || {};
    return {
      'tool-card': true,
      'is-collapsed': isCollapsed.value,
      'no-border': !!layout.hideBorder,
      'no-background': !!layout.hideBackground,
      'full-width': !!layout.fullWidth,
      'no-overflow': !!layout.overflowVisible,
    };
  });

  const registryContentClasses = computed(() => {
    const layout = registryConfig.value?.layout || {};
    return { 'no-padding': !!layout.noPadding };
  });

  const shouldHideContent = computed(() => (
    toolPresentation.value?.hideContent === true
    || registryConfig.value?.layout?.hideContent === true
  ));

  const shouldShowRegistryContent = computed(() => {
    if (shouldHideContent.value) return false;
    if (!registryTitleText.value) return true;
    return !isCollapsed.value;
  });

  const shouldMountRegistryComponent = computed(() => {
    if (shouldHideContent.value) return false;
    return true;
  });

  const canToggleRegistryCollapse = computed(() => {
    if (shouldHideContent.value) return false;
    return !!registryTitleText.value;
  });

  return {
    registryConfig,
    isRegistryRenderAsGroup,
    rawRegistryTitle,
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
  };
}
