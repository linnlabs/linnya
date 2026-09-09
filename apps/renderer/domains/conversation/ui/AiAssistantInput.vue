<!-- apps/renderer/features/AiAssistant/ui/AiAssistantInput.vue -->
<template>
  <div
    class="ai-assistant-input conversation-footer-shell"
    :class="`ai-assistant-input--${variant}`"
    @dragenter.capture="handleImageDragEnter"
    @dragover.capture="handleImageDragOver"
    @dragleave.capture="handleImageDragLeave"
    @drop.capture="handleImageDrop"
  >
    <!-- 输入区域 -->
    <div class="input-container">
      <div
        class="input-wrapper conversation-footer-surface"
        :class="{
          'is-selector-interacting': isSelectorInteracting,
          'is-disabled': isInputDisabled,
          'has-input-accessories': visibleInputAccessories.length > 0,
        }"
      >
        <component
          :is="activeInputExtension.contextBar.component"
          v-if="activeInputExtension"
          :key="activeInputExtension.id"
          :payload="activeInputExtension.contextBar.payload.value"
          :handles="inputContextBarHandles"
        />

        <ConversationInputAccessoryHost
          :accessories="visibleInputAccessories"
          :disabled="isInputDisabled"
        />

        <AiAssistantQuotePreview />

        <ConversationImageAttachmentDraftStrip
          :items="imageDraftStore.items"
          :message="imageSubmitMessage"
          :disabled="isSubmissionStarting"
          @remove="handleRemoveImageDraft"
          @retry="handleRetryImageDraft"
        />

        <ConversationImageAttachmentPicker
          ref="imageAttachmentPickerRef"
          :disabled="isImageEntryDisabled"
          :title="imageEntryTitle"
          :show-trigger="false"
          @files-selected="handleImageFilesSelected"
        />

        <!-- 上栏：文本输入区域 -->
        <div class="input-top-section">
          <EditorContent 
            :editor="editor ?? undefined"
            class="input-editor"
            :class="{ 'is-disabled': isInputDisabled }"
          />
        </div>
        
        <!-- 下栏：选择器和发送按钮 -->
        <AiAssistantInputFooter
          :variant="variant"
          :active-agent-choice-id="activeAgentChoiceId"
          :active-agent-choice-pill-text="activeAgentChoicePillText"
          :active-agent-choice-aria-label="activeAgentChoiceAriaLabel"
          :primary-model-value="primaryModelValue"
          :model-select-options="modelSelectOptions"
          :is-loading="isLoading"
          :is-streaming="isStreaming"
          :can-send="canSend"
          :is-models-loading="isModelsLoading"
          :is-image-attachment-disabled="isImageEntryDisabled"
          :context-window-usage="contextWindowUsage"
          :context-window-conversation-information="contextWindowConversationInformation"
          :context-window-usage-scope-key="conversationSelectors.activeConversation.value?.id ?? 'draft'"
          :disabled="isInputDisabled"
          @update:agent-choice="handleAgentChoiceChange"
          @update:primary-model-value="handlePrimaryModelChange"
          @manage-models="openModelSettings"
          @selector-interaction-change="handleSelectorInteractionChange"
          @request-image-attachment="openImageAttachmentPicker"
          @submit="handleSubmit"
        />

        <button
          v-if="isModelSetupRequired"
          type="button"
          class="ai-assistant-input__model-setup-overlay"
          :aria-label="conversationMessage('conversation.input.model.configure')"
          @click="openModelSetup"
        >
          {{ conversationMessage('conversation.input.model.configure') }}
        </button>

        <div
          v-if="isImageDragActive"
          class="ai-assistant-input__image-drop-overlay"
          :class="{ 'is-blocked': isImageEntryDisabled }"
        >
          {{ conversationMessage(isImageEntryDisabled
            ? 'conversation.input.image.dropBlocked'
            : 'conversation.input.image.drop') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue';
import { Editor as TiptapEditor, EditorContent } from '@tiptap/vue-3';
import type { Content, Editor as TiptapCoreEditor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Placeholder, UndoRedo as History } from '@tiptap/extensions';
import HardBreak from '@tiptap/extension-hard-break';
import { useAssistantStore } from '../store/assistantStore';
import { useConversationState } from '../store/conversationState';
import { useConversationSelectors } from '../store/selectors';
import {
  modelAcceptsUserImageInput,
  shouldPromptForModelSetup,
  useModelCatalogReadModel,
  useModelPickerReadModel,
  useModelPurposeBindings,
} from '@/domains/model-configuration';
import { useWorkspaceScopeStore } from '../../../shared/stores/workspaceScopeStore';
import { useConversationAgentChoices } from '@/app/plugins/composables';
import { useLocalization } from '@/app/localization';
import { resolveConversationAgentChoiceTextPresentation } from '@/app/plugins/functions/pluginContributionPresentation';
import { useChatFlowOrchestrator } from '../services/orchestration/chatFlowOrchestrator';
import {
  applyConversationAgentChoice,
  resolveConversationAgentChoice,
  type ConversationAgentChoiceId,
} from '../features/agent-choice';
import AiAssistantQuotePreview from './AiAssistantInput/AiAssistantQuotePreview.vue';
import AiAssistantInputFooter from './AiAssistantInput/AiAssistantInputFooter.vue';
import type { ConversationSurfaceVariant } from '../definitions/conversationPresentation';
import { buildUserQuotePayloadFromConversationReferences } from '../functions/conversationReferences';
import { useComposerReferences } from '../features/composer-references';
import {
  type ConversationInputContextBarHandles,
  type ConversationInputExtensionSubmitPayload,
  createRegisteredConversationInputEditorExtensions,
  executeConversationInputExtensionSubmit,
  useConversationInputExecution,
} from '../features/input-extensions';
import {
  ConversationInputAccessoryHost,
  useConversationInputAccessories,
} from '../features/input-accessories';
import { useConversationReferenceSuggestion } from '../features/reference-mention';
import { useConversationModelSelection } from '../features/model-selection/orchestration/useConversationModelSelection';
import { useConversationLocalization } from './useConversationLocalization';
import {
  ConversationImageAttachmentDraftStrip,
  ConversationImageAttachmentPicker,
  type ConversationImageAttachmentPickerHandle,
  type ConversationImageEntrySource,
  createConversationImageDraftSubmissionSnapshot,
  resolveImageAttachmentErrorMessage,
  resolveConversationImageSubmitPreflight,
  selectConversationImageFiles,
  useConversationImageAttachmentDrafts,
} from '../features/image-attachments';
import {
  projectConversationInformation,
  useContextWindowUsagePresentation,
} from '../features/context-window-usage';
import { useHistoryListStore } from '../history/store/historyListStore';
import { useUIStore } from '../../../shared/stores/ui';

const props = defineProps<{
  placeholder?: string;
  variant?: ConversationSurfaceVariant;
  disabled?: boolean;
  onUserMessageCommitted?: () => void;
}>();

const variant = computed(() => props.variant ?? 'regular');

// Store
const assistantStore = useAssistantStore();
const conversationState = useConversationState();
const conversationSelectors = useConversationSelectors(conversationState);
const historyListStore = useHistoryListStore();
const composerReferences = useComposerReferences();
const modelCatalog = useModelCatalogReadModel();
const modelPicker = useModelPickerReadModel();
const modelBindings = useModelPurposeBindings();
const uiStore = useUIStore();
const workspaceScopeStore = useWorkspaceScopeStore();
const { conversationMessage } = useConversationLocalization();
const { t } = useLocalization();
const contextWindowUsage = useContextWindowUsagePresentation({
  hasActiveConversation: conversationSelectors.hasActiveConversation,
  messages: conversationSelectors.activeMessages,
  includesConversationTail: conversationSelectors.activeMessageWindowIncludesConversationTail,
  currentModelId: modelBindings.effectivePrimaryModelId,
});
const contextWindowConversationInformation = computed(() => {
  const conversation = conversationSelectors.activeConversation.value;
  if (!conversation) return null;

  const historyConversation = historyListStore.conversations.find(candidate => (
    candidate.conversation_id === conversation.id
  ));
  return projectConversationInformation({
    createdAt: conversation.createdAt,
    messages: conversationSelectors.activeMessages.value,
    persistedUserMessageCount: historyConversation?.user_message_count
      ?? conversation.userMessageCount,
  });
});
// 编排器
const chatFlowOrchestrator = useChatFlowOrchestrator({
  onUserMessageCommitted: () => {
    clearComposerDraft();
    imageDraftController.acceptCommitted();
    props.onUserMessageCommitted?.();
  },
});
const inputExecution = useConversationInputExecution({
  isLoading: () => assistantStore.isLoading,
  isStreaming: () => assistantStore.isStreaming,
  cancel: () => assistantStore.cancelCurrentStream(),
});
const activeInputExtension = inputExecution.activeExtension;
const referenceSuggestion = useConversationReferenceSuggestion({
  canUseReferences: () => activeInputExtension.value?.acceptsReferences ?? true,
});
const { store: imageDraftStore, controller: imageDraftController } = useConversationImageAttachmentDrafts();
const imageEntryMessage = ref('');
const isSubmissionStarting = ref(false);
const isAgentChoiceUpdating = ref(false);
const isImageDragActive = ref(false);
const imageAttachmentPickerRef = ref<ConversationImageAttachmentPickerHandle | null>(null);
let imageDragDepth = 0;

// Tiptap 编辑器
/**
 * 这里显式使用 `@tiptap/vue-3` 导出的 Editor 实例类型：
 * - 该类型与 `<editor-content :editor="...">` 的 prop 定义保持一致；
 * - 避免因“同名 Editor 来自不同声明/包”造成的 TS 不兼容报错。
 */
/**
 * 用 `EditorContent` 的 props 类型作为“单一真源”，彻底避免 tiptap 的 Editor 类型在不同导出路径下出现不兼容。
 */
type EditorForEditorContent = InstanceType<typeof EditorContent>['$props']['editor'];

/**
 * 说明：
 * - 我们内部用 `null` 表示“尚未创建 Editor”更符合直觉；
 * - 传给 `<EditorContent>` 时用 `editor ?? undefined` 转换为 `undefined`，与 props 类型对齐。
 */
const editor = shallowRef<EditorForEditorContent | null>(null);

const inputContextBarHandles: ConversationInputContextBarHandles = {
  composer: {
    insertInlineToken(token): boolean {
      if (!editor.value) return false;
      return editor.value.chain().focus().insertContent({
        type: token.type,
        attrs: { ...token.attributes },
      }).run();
    },
  },
  deactivate(): void | Promise<void> {
    const extension = activeInputExtension.value;
    if (!extension) return;
    return extension.onDeactivate();
  },
};

const clearComposerText = (): void => {
  assistantStore.setInputText('');
  editor.value?.commands.clearContent();
};

const clearComposerDraft = (): void => {
  clearComposerText();
  composerReferences.clearReferences();
};

/**
 * 从 Tiptap Editor 中提取“可发送”的纯文本（保留换行）。
 *
 * 根因说明：
 * - 之前发送前做了 `replace(/\n{2,}/g, '\n')`，会把用户主动输入的多行/空行压扁；
 * - TipTap schema serializer 会调用扩展的 `renderText`，hardBreak 和自定义 inline token
 *   与普通文本走同一条序列化路径，conversation 不按节点名分支。
 */
type PlainTextEditor = Pick<TiptapCoreEditor, 'getText'>;

const getEditorPlainText = (value?: PlainTextEditor | null): string => {
  if (!value) return '';
  return value.getText({ blockSeparator: '\n' });
};

/**
 * 将纯文本（包含 '\n'）转换为可被 Tiptap `setContent` 接收的 JSON 文档。
 *
 * 重要说明（根因关联）：
 * - 本组件内部用 schema serializer 把“段落分隔”和 hardBreak 都序列化为 '\n'；
 * - 因此从纯文本无法可靠还原“这是段落还是 hard_break”，这里统一回放为同一段落内的 `hardBreak`，
 *   目标是确保“视觉换行”稳定不丢（避免 `setContent(string)` 解析时吞掉换行）。
 */
const plainTextToTiptapContent = (text: string): Content => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const paragraphContent: Array<{ type: 'text'; text: string } | { type: 'hardBreak' }> = [];

  lines.forEach((line, idx) => {
    if (line.length > 0) {
      paragraphContent.push({ type: 'text', text: line });
    }
    if (idx !== lines.length - 1) {
      paragraphContent.push({ type: 'hardBreak' });
    }
  });

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: paragraphContent,
      },
    ],
  };
};

/**
 * 会话级 Agent 产品身份是单一真源；菜单项 id 只负责把 registry 贡献映射到该身份。
 */
const enabledConversationAgentChoices = useConversationAgentChoices();
const activeConversationAgentChoice = computed(() =>
  resolveConversationAgentChoice(
    assistantStore.activeConversation?.selectedAgentId ?? null,
    enabledConversationAgentChoices.value,
  )
);
const activeAgentChoiceId = computed<ConversationAgentChoiceId | null>(() => {
  return activeConversationAgentChoice.value?.id ?? null;
});
const activeAgentChoicePillText = computed(() => {
  const agentChoice = activeConversationAgentChoice.value;
  return agentChoice ? resolveConversationAgentChoiceTextPresentation(agentChoice, t).pillText : null;
});
const activeAgentChoiceAriaLabel = computed(() => {
  const agentChoice = activeConversationAgentChoice.value;
  return agentChoice ? resolveConversationAgentChoiceTextPresentation(agentChoice, t).ariaLabel : null;
});

const isLoading = inputExecution.isLoading;
const isStreaming = inputExecution.isStreaming;
const isInputDisabled = computed(() => (
  props.disabled === true
  || isLoading.value
  || isStreaming.value
  || isSubmissionStarting.value
  || isAgentChoiceUpdating.value
));
const isModelSetupRequired = computed(() => (
  shouldPromptForModelSetup(modelPicker.snapshot.value, isInputDisabled.value)
));
const isImageEntryDisabled = computed(() => (
  isInputDisabled.value || activeInputExtension.value?.acceptsAttachments === false
));
const imageEntryTitle = computed(() => (
  activeInputExtension.value?.acceptsAttachments === false
    ? conversationMessage('conversation.input.image.extensionUnsupported')
    : conversationMessage('conversation.input.image.add')
));

function openImageAttachmentPicker(): void {
  imageAttachmentPickerRef.value?.openPicker();
}
const visibleInputAccessories = useConversationInputAccessories({
  isBlockedByInputExtension: () => activeInputExtension.value !== null,
});
const activeChatModel = computed(() => {
  const activeModelId = modelBindings.effectivePrimaryModelId.value;
  return modelCatalog.models.value.find(model => model.id === activeModelId);
});
const imageSubmitPreflight = computed(() => resolveConversationImageSubmitPreflight({
  text: assistantStore.inputText,
  items: imageDraftStore.items,
  activeModelAcceptsUserImages: modelAcceptsUserImageInput(activeChatModel.value),
  extensionAcceptsAttachments: activeInputExtension.value?.acceptsAttachments ?? true,
}));
const imageSubmitMessage = computed(() => {
  if (imageEntryMessage.value) return imageEntryMessage.value;
  if (imageDraftStore.items.length === 0 || imageSubmitPreflight.value.ok) return '';
  if (imageSubmitPreflight.value.reason === 'model_unsupported') {
    return conversationMessage('conversation.error.imageModelUnsupported');
  }
  if (imageSubmitPreflight.value.reason === 'extension_unsupported') {
    return conversationMessage('conversation.input.image.extensionUnsupported');
  }
  return '';
});

const canSend = computed(() => {
  return imageSubmitPreflight.value.ok && !isInputDisabled.value;
});

function stageImageFiles(input: {
  readonly source: ConversationImageEntrySource;
  readonly files: readonly File[];
  readonly hasPlainText?: boolean;
}): boolean {
  const selection = selectConversationImageFiles(input);
  if (selection.files.length === 0) return false;
  if (isImageEntryDisabled.value) {
    if (activeInputExtension.value?.acceptsAttachments === false) {
      imageEntryMessage.value = conversationMessage('conversation.input.image.extensionUnsupported');
    }
    return selection.shouldConsumeEvent;
  }

  const result = imageDraftController.stageFiles(selection.files);
  imageEntryMessage.value = result.kind === 'rejected'
    ? conversationMessage(resolveImageAttachmentErrorMessage(result.code))
    : '';
  return selection.shouldConsumeEvent;
}

function handleImageFilesSelected(files: readonly File[]): void {
  stageImageFiles({ source: 'picker', files });
}

function handleRemoveImageDraft(clientId: string): void {
  imageDraftController.remove(clientId);
  imageEntryMessage.value = '';
}

function handleRetryImageDraft(clientId: string): void {
  if (imageDraftController.retry(clientId)) imageEntryMessage.value = '';
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function handleImageDragEnter(event: DragEvent): void {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  imageDragDepth += 1;
  isImageDragActive.value = true;
}

function handleImageDragOver(event: DragEvent): void {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function handleImageDragLeave(event: DragEvent): void {
  if (!carriesFiles(event)) return;
  imageDragDepth = Math.max(0, imageDragDepth - 1);
  if (imageDragDepth === 0) isImageDragActive.value = false;
}

function handleImageDrop(event: DragEvent): void {
  imageDragDepth = 0;
  isImageDragActive.value = false;
  const handled = stageImageFiles({
    source: 'drop',
    files: Array.from(event.dataTransfer?.files ?? []),
  });
  if (!handled) return;
  event.preventDefault();
  event.stopPropagation();
}

const isModelsLoading = computed(() => modelCatalog.activeOperation.value !== null);
const isFooterSelectorInteracting = ref(false);
const isSelectorInteracting = computed(
  () => isFooterSelectorInteracting.value || referenceSuggestion.isOpen.value,
);

const inputPlaceholder = computed(() => {
  if (props.placeholder && props.placeholder.trim().length > 0) {
    return props.placeholder;
  }
  return conversationMessage('conversation.input.placeholder');
});

const conversationModelSelection = useConversationModelSelection({
  modelCatalog,
  modelPicker,
  modelBindings,
  hasImageDrafts: () => imageDraftStore.items.length > 0,
  isDisabled: () => isInputDisabled.value,
  conversationMessage,
});
const primaryModelValue = conversationModelSelection.primaryModelValue;
const modelSelectOptions = conversationModelSelection.modelSelectOptions;

/**
 * 会话级 Agent 选择：Host 持久化成功后才更新 Renderer read model。
 */
const handleAgentChoiceChange = async (agentChoiceId: ConversationAgentChoiceId | null) => {
  if (isInputDisabled.value) return;

  isAgentChoiceUpdating.value = true;
  try {
    await applyConversationAgentChoice({
      assistantStore,
      scopeStore: workspaceScopeStore,
      agentChoiceId,
      choices: enabledConversationAgentChoices.value,
    });
  } catch (error) {
    console.error('[AiAssistantInput] 更新会话 Agent 失败:', error);
    assistantStore.setError(conversationMessage('conversation.input.agentChoice.persistFailed'));
  } finally {
    isAgentChoiceUpdating.value = false;
  }
};

const handlePrimaryModelChange = conversationModelSelection.selectPrimaryModelMenuValue;

const openModelSettings = () => uiStore.openSettingsModal('model-management');
const openModelSetup = (): void => {
  uiStore.openSettingsModal('model');
};

/**
 * 中文说明：
 * - 过去依赖 `:has(select:focus)` 推断“底栏选择器是否正在交互”；
 * - 但这里实际使用的是自定义下拉，不是原生 select，导致样式判断既不准确也会触发昂贵的 CSS 重算；
 * - 改为由 footer 显式上报交互状态，父组件只做简单 class 切换。
 */
const handleSelectorInteractionChange = (value: boolean) => {
  isFooterSelectorInteracting.value = value;
};

const handleSubmit = async () => {
  // 如果正在流式传输，则取消当前流
  if (isStreaming.value) {
    inputExecution.cancel();
    return;
  }

  if (!canSend.value) return;
  // 发送点击后立即冻结草稿；后续历史尾窗和文档上下文读取都可能异步等待。
  isSubmissionStarting.value = true;

  // 从编辑器读取当前文本，确保换行按 '\n' 保留；只做 Windows 换行归一化
  const rawText = getEditorPlainText(editor.value);
  const normalizedText = rawText.replace(/\r\n/g, '\n');
  const message = normalizedText.trimEnd();
  const imageSubmission = createConversationImageDraftSubmissionSnapshot(imageDraftStore.items);

  // 在清空之前快照当前扩展与引用，确保结构化 userQuote 不因清空 composer 丢失。
  const extensionSnapshot = activeInputExtension.value;
  const conversationReferencesSnapshot = [...composerReferences.references.value];
  const userQuotePayload = buildUserQuotePayloadFromConversationReferences(conversationReferencesSnapshot);
  const extensionSubmitPayload: ConversationInputExtensionSubmitPayload = {
    text: message,
    references: conversationReferencesSnapshot,
  };

  try {
    if (extensionSnapshot) {
      await executeConversationInputExtensionSubmit({
        extension: extensionSnapshot,
        payload: extensionSubmitPayload,
        clearDraftAfterStart: clearComposerDraft,
      });
    } else {
      await chatFlowOrchestrator.sendChatMessage({
        text: message,
        ...(userQuotePayload ? { userQuote: userQuotePayload } : {}),
      }, {}, imageSubmission);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    console.error('[AiAssistantInput] 发送消息失败:', error);
  } finally {
    isSubmissionStarting.value = false;
  }
};

/**
 * 中文说明（根因级修复）：
 * - 之前这里监听旧模式选择器并在 nextTick 里调 editor.commands.focus()；
 * - Tiptap focus() 会创建并分发 ProseMirror 事务（即使文档没变），触发：
 *   1) 所有插件的 apply/handleDOMEvents
 *   2) 浏览器焦点事件级联（focusin/focusout）
 *   3) CSS :focus-within 变动，引发多层 box-shadow 过渡动画的逐帧重绘
 * - 编辑器已有较多内容时，整条链路代价显著更高
 * - 而且这个 watch 的 UX 也不好：用户刚点了选择器，焦点却被强制拉回编辑器
 * - 移除后，用户下次点击编辑器或按 Tab 自然获得焦点即可
 */

const syncEditorEditable = () => {
  /**
   * 历史会话正在恢复时，底部输入框必须真正不可编辑。
   * 只改视觉 class 不够：Tiptap 仍可能保留焦点并接收键盘事件。
   */
  editor.value?.setEditable(!isInputDisabled.value);
};

// 监听来自 store 的 inputText 变化，并同步到编辑器
watch(() => assistantStore.inputText, (newText) => {
  if (!editor.value) return;

  /**
   * 根因修复：
   * - 之前用 `editor.getText()` 做比较，遇到 hard_break/原子节点时序列化规则不一致，导致误判“内容不同”；
   * - 随后 `setContent(string)` 会把 '\n' 当作普通文本/HTML 解析掉，直接抹掉换行节点；
   * - 这里改为：用同一套序列化函数 `getEditorPlainText` 对齐比较口径，并用 JSON content 回写，确保换行稳定。
   */
  const currentText = getEditorPlainText(editor.value);
  if (currentText === newText) return;

  // emitUpdate=false：避免“回写编辑器”再次触发 onUpdate，引发不必要的状态抖动
  editor.value.commands.setContent(plainTextToTiptapContent(newText), { emitUpdate: false });
});

watch(isInputDisabled, syncEditorEditable);

watch(activeInputExtension, (nextExtension, previousExtension) => {
  if (previousExtension && previousExtension.id !== nextExtension?.id) {
    clearComposerText();
  }
});

// Tiptap 编辑器初始化
onMounted(() => {
  editor.value = new TiptapEditor({
    extensions: [
      Document,
      Paragraph.configure({
        HTMLAttributes: {
          class: 'ai-assistant-paragraph',
        },
      }),
      Text,
      HardBreak,
      referenceSuggestion.editorExtension,
      ...createRegisteredConversationInputEditorExtensions(),
      History,
      Placeholder.configure({
        placeholder: () => inputPlaceholder.value,
      }),
    ],
    // Surface 在主区与右侧之间切换时会按生命周期重建编辑器；草稿真值在 store，
    // 初始化必须从同一真值恢复，不能等待一次不会发生的 inputText 变更。
    content: plainTextToTiptapContent(assistantStore.inputText),
    autofocus: false,
    editable: !isInputDisabled.value,
    editorProps: {
      attributes: {
        class: 'ai-assistant-tiptap-editor',
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
      },
      handleKeyDown: (view, event) => {
        if (isInputDisabled.value && !isStreaming.value) {
          return true;
        }

        // @ 候选打开时，键盘事件必须交给 Suggestion 插件；否则宿主会先吃掉 Enter 并发送消息。
        if (referenceSuggestion.isOpen.value) {
          return false;
        }

        // 处理回车键行为
        if (event.key === 'Enter') {
          if (event.shiftKey) {
            // Shift + Enter: 插入硬换行符
            event.preventDefault();
            return editor.value?.commands.setHardBreak() || false;
          } else {
            // Enter: 发送消息
            event.preventDefault();
            handleSubmit();
            return true;
          }
        }
        return false;
      },
      handlePaste: (_view, event) => stageImageFiles({
        source: 'paste',
        files: Array.from(event.clipboardData?.files ?? []),
        hasPlainText: (event.clipboardData?.getData('text/plain').length ?? 0) > 0,
      }),
    },
    onUpdate: ({ editor }) => {
      // 使用统一序列化逻辑，确保换行稳定保留
      const currentText = getEditorPlainText(editor);
      assistantStore.setInputText(currentText);
      activeInputExtension.value?.onTextChange?.(currentText);

      // 根因修复：
      // 输入区滚动位置应由编辑器原生行为和用户光标位置共同决定，
      // 不能在每次更新时强制拉到底部，否则会破坏“在中间/开头编辑长文本”的体验。
    },
  });

  syncEditorEditable();
});
// 组件销毁前销毁Tiptap编辑器
onBeforeUnmount(() => {
  if (editor.value) {
    editor.value.destroy();
  }
});
</script>
