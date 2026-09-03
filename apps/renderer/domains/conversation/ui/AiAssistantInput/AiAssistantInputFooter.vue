<template>
  <div
    class="ai-assistant-input-footer input-bottom-section"
    :class="[
      `input-bottom-section--${variant}`,
      { 'is-controls-disabled': isInputControlsDisabled },
    ]"
  >
    <div class="selectors-wrapper">
      <div
        ref="selectorsRowRef"
        class="selectors-top-row"
        @focusin="handleSelectorsFocusIn"
        @focusout="handleSelectorsFocusOut"
      >
        <!-- 输入能力统一从“+”菜单进入，附件与 Agent 不再占用独立底栏按钮。 -->
        <div class="input-action-menu-container">
          <button
            ref="inputActionMenuButtonRef"
            type="button"
            class="input-action-menu-button"
            :disabled="isInputControlsDisabled"
            :title="conversationMessage('conversation.input.actionMenu.open')"
            aria-haspopup="menu"
            :aria-expanded="showInputActionMenu.toString()"
            @click="toggleInputActionMenu"
            @keydown.down.prevent="openInputActionMenu"
            @keydown.up.prevent="openInputActionMenu"
          >
            <AddIcon class="input-action-menu-add-icon" />
          </button>

          <Teleport to="body">
            <transition name="ai-assistant-input-action-menu-fade">
              <div
                v-show="showInputActionMenu"
                ref="inputActionMenuWrapperRef"
                class="ai-assistant-input-footer__input-action-menu-wrapper"
              >
                <CustomSelect
                  :model-value="null"
                  :options="inputActionMenuOptions"
                  :manual-mode="true"
                  semantic-role="menu"
                  :parent-is-open="showInputActionMenu"
                  :trigger-aria-label="conversationMessage('conversation.input.actionMenu.open')"
                  variant="minimal"
                  :bordered="false"
                  :class-names="{
                    options: 'input-action-menu-options',
                    submenu: 'input-action-menu-submenu',
                    option: 'input-action-menu-option',
                    optionLabel: 'input-action-menu-option-label',
                  }"
                  :external-trigger-ref="inputActionMenuButtonRef"
                  @update:model-value="handleInputActionMenuSelect"
                  @close="showInputActionMenu = false"
                />
              </div>
            </transition>
          </Teleport>
        </div>

        <div
          v-if="activeAgentChoiceId && activeAgentChoicePillText && activeAgentChoiceAriaLabel"
          class="selector-group selector-group--agent-choice"
        >
          <div
            class="select-trigger select-trigger--minimal agent-choice-trigger"
            :class="{ 'is-disabled': isInputControlsDisabled }"
            role="button"
            :aria-label="activeAgentChoiceAriaLabel"
          >
            <button
              type="button"
              class="agent-choice-trigger-close"
              :disabled="isInputControlsDisabled"
              @click.stop="clearAgentChoice"
              :aria-label="conversationMessage('conversation.input.agentChoice.closeCurrent')"
              :title="conversationMessage('conversation.input.agentChoice.close')"
            >
              <component
                :is="activeAgentChoiceIconComponent"
                class="agent-choice-trigger-icon agent-choice-trigger-icon--default"
              />
              <CloseIcon class="agent-choice-trigger-icon agent-choice-trigger-icon--hover" />
            </button>
            <span class="agent-choice-trigger-text">{{ activeAgentChoicePillText }}</span>
          </div>
        </div>

        <!-- 模型选择跟随输入能力放在左侧，较长名称在窄窗口中优先省略。 -->
        <div class="selector-group selector-group--model">
          <CustomSelect
            class="input-footer-model-select"
            :model-value="primaryModelValue"
            :options="modelSelectOptions"
            @update:modelValue="handlePrimaryModelChange"
            :placeholder="isModelsLoading
              ? conversationMessage('conversation.input.model.loading')
              : conversationMessage('conversation.input.model.placeholder')"
            :disabled="isModelsLoading || isInputControlsDisabled"
            variant="minimal"
            :bordered="false"
            font-size="12px"
            option-label-overflow="marquee-on-hover"
            :class-names="{
              trigger: 'input-footer-model-trigger',
              selectedValue: 'input-footer-model-selected-value',
              options: 'input-footer-model-options',
              optionsHeader: 'input-footer-model-options-header',
            }"
          >
            <template #arrow-icon="{ isOpen }">
              <ChevronIcon
                direction="up"
                class="selector-chevron"
                :class="{ 'is-open': isOpen }"
              />
            </template>
          </CustomSelect>
        </div>

      </div>
    </div>

    <div class="ai-assistant-input-footer__primary-actions">
      <ContextWindowUsageDropdown
        :key="contextWindowUsageScopeKey"
        :presentation="contextWindowUsage"
        :conversation-information="contextWindowConversationInformation"
      />

      <button
        :class="['send-button', { disabled: !canSend && !isStreaming }]"
        :disabled="!canSend && !isStreaming"
        @click="handleSubmit"
      >
        <!-- 流式传输时显示停止图标 -->
        <span v-if="isStreaming" class="stop-icon">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </span>
        <!-- 加载时显示转圈圈 -->
        <span v-else-if="isLoading" class="loading-spinner">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="animate-spin"
          >
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
        </span>
        <!-- 默认发送图标 -->
        <span v-else class="send-icon">
          <EnterLeftIcon class="enter-left-icon" />
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { PropType, Component } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { EnterLeftIcon } from '@linnya/renderer-ui/icons';
import { ImageIcon } from '@linnya/renderer-ui/icons';
import ContextWindowUsageDropdown from '../../features/context-window-usage/ui/ContextWindowUsageDropdown.vue';
import { useConversationAgentChoices } from '@/app/plugins/composables';
import { useLocalization } from '@/app/localization';
import { resolveConversationAgentChoiceTextPresentation } from '@/app/plugins/functions/pluginContributionPresentation';
import type { ConversationAgentChoiceId } from '../../features/agent-choice';
import type { ModelSelectOption } from '../../definitions/modelSelectOption';
import { MANAGE_CONVERSATION_MODELS_VALUE } from '../../features/model-selection/definitions/conversationModelMenu';
import type {
  ContextWindowUsagePresentation,
  ConversationInformationPresentation,
} from '../../features/context-window-usage';
import { useConversationLocalization } from '../useConversationLocalization';
import {
  CONVERSATION_IMAGE_ATTACHMENT_MENU_VALUE,
  buildConversationInputActionMenuOptions,
  readConversationAgentMenuValue,
  type ConversationInputActionMenuOption,
} from '../../features/input-action-menu';

const props = defineProps({
  activeAgentChoiceId: {
    type: String as PropType<ConversationAgentChoiceId | null>,
    default: null,
  },
  activeAgentChoicePillText: {
    type: String as PropType<string | null>,
    default: null,
  },
  activeAgentChoiceAriaLabel: {
    type: String as PropType<string | null>,
    default: null,
  },
  primaryModelValue: {
    type: String as PropType<string | null>,
    default: null,
  },
  modelSelectOptions: {
    type: Array as PropType<ModelSelectOption[]>,
    required: true,
  },
  isLoading: {
    type: Boolean,
    required: true,
  },
  isStreaming: {
    type: Boolean,
    required: true,
  },
  canSend: {
    type: Boolean,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  isModelsLoading: {
    type: Boolean,
    required: true,
  },
  isImageAttachmentDisabled: {
    type: Boolean,
    default: false,
  },
  contextWindowUsage: {
    type: Object as PropType<ContextWindowUsagePresentation>,
    required: true,
  },
  contextWindowConversationInformation: {
    type: Object as PropType<ConversationInformationPresentation | null>,
    default: null,
  },
  contextWindowUsageScopeKey: {
    type: String,
    required: true,
  },
  variant: {
    type: String as PropType<'regular' | 'compact'>,
    default: 'regular',
  },
});

const emit = defineEmits<{
  (e: 'update:agent-choice', value: ConversationAgentChoiceId | null): void;
  (e: 'update:primaryModelValue', value: string | null): void;
  (e: 'manage-models'): void;
  (e: 'selector-interaction-change', value: boolean): void;
  (e: 'request-image-attachment'): void;
  (e: 'submit'): void;
}>();

const conversationAgentChoices = useConversationAgentChoices();
const { conversationMessage } = useConversationLocalization();
const { t } = useLocalization();
const isInputControlsDisabled = computed(() => props.disabled || props.isLoading || props.isStreaming);

const inputActionMenuOptions = computed<ConversationInputActionMenuOption[]>(() => {
  const agents = conversationAgentChoices.value.map((agentChoice) => {
    const agentChoiceText = resolveConversationAgentChoiceTextPresentation(agentChoice, t);
    return {
      id: agentChoice.id,
      label: agentChoiceText.menuText,
      disabled: props.activeAgentChoiceId === agentChoice.id,
      iconComponent: agentChoice.iconComponent,
    };
  });

  return buildConversationInputActionMenuOptions({
    attachmentGroupLabel: conversationMessage('conversation.input.actionMenu.attachmentGroup'),
    agentGroupLabel: conversationMessage('conversation.input.actionMenu.agentGroup'),
    imageLabel: conversationMessage('conversation.input.image.menuItem'),
    imageIconComponent: ImageIcon,
    imageDisabled: props.isImageAttachmentDisabled,
    agents,
  });
});

const activeAgentChoiceIconComponent = computed<Component | null>(() => {
  if (!props.activeAgentChoiceId) return null;
  return conversationAgentChoices.value
    .find((agentChoice) => agentChoice.id === props.activeAgentChoiceId)?.iconComponent ?? null;
});

const showInputActionMenu = ref(false);
const inputActionMenuButtonRef = ref<HTMLElement | null>(null);
const inputActionMenuWrapperRef = ref<HTMLElement | null>(null);
const selectorsRowRef = ref<HTMLElement | null>(null);

let selectorInteractionResetTimer: number | null = null;

const clearSelectorInteractionResetTimer = () => {
  if (selectorInteractionResetTimer !== null) {
    clearTimeout(selectorInteractionResetTimer);
    selectorInteractionResetTimer = null;
  }
};

/**
 * 中文说明：
 * - 输入框外层的 focus 态不再通过 `:has(...)` 猜测“是不是在点选择器”；
 * - 改为由底栏显式告诉父组件：当前焦点是否落在 selector 区域内，避免浏览器在每次焦点切换时做高成本选择器回溯。
 */
const handleSelectorsFocusIn = () => {
  clearSelectorInteractionResetTimer();
  emit('selector-interaction-change', true);
};

const handleSelectorsFocusOut = (event: FocusEvent) => {
  const selectorsRowEl = selectorsRowRef.value;
  const nextTarget = event.relatedTarget;
  if (selectorsRowEl && nextTarget instanceof Node && selectorsRowEl.contains(nextTarget)) {
    return;
  }

  // 延后一拍再收口，避免同一轮焦点切换里出现状态抖动。
  clearSelectorInteractionResetTimer();
  selectorInteractionResetTimer = window.setTimeout(() => {
    emit('selector-interaction-change', false);
    selectorInteractionResetTimer = null;
  }, 0);
};

const toggleInputActionMenu = () => {
  if (isInputControlsDisabled.value) return;
  showInputActionMenu.value = !showInputActionMenu.value;
};

const openInputActionMenu = () => {
  if (isInputControlsDisabled.value) return;
  showInputActionMenu.value = true;
};

const handleInputActionMenuSelect = (value: string | null) => {
  if (isInputControlsDisabled.value) {
    showInputActionMenu.value = false;
    return;
  }

  if (!value) {
    showInputActionMenu.value = false;
    return;
  }
  if (value === CONVERSATION_IMAGE_ATTACHMENT_MENU_VALUE) {
    emit('request-image-attachment');
    showInputActionMenu.value = false;
    return;
  }
  const agentChoiceId = readConversationAgentMenuValue(value);
  if (agentChoiceId) {
    emit('update:agent-choice', agentChoiceId);
  }
  showInputActionMenu.value = false;
};

const positionInputActionMenu = () => {
  const triggerEl = inputActionMenuButtonRef.value;
  const wrapperEl = inputActionMenuWrapperRef.value;
  if (!triggerEl || !wrapperEl) return;

  const triggerRect = triggerEl.getBoundingClientRect();
  const wrapperRect = wrapperEl.getBoundingClientRect();

  // 默认放在按钮上方（输入区在底部）
  let top = triggerRect.top - wrapperRect.height - 6;
  let left = triggerRect.left;

  // 左右溢出修正
  if (left + wrapperRect.width > window.innerWidth - 8) {
    left = Math.max(8, triggerRect.right - wrapperRect.width);
  }
  if (left < 8) left = 8;

  // 顶部溢出则放到按钮下方
  if (top < 8) {
    top = triggerRect.bottom + 6;
  }
  if (top + wrapperRect.height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - wrapperRect.height - 8);
  }

  wrapperEl.style.top = `${top}px`;
  wrapperEl.style.left = `${left}px`;
};

watch(showInputActionMenu, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      positionInputActionMenu();
    });
  }
});

watch(isInputControlsDisabled, (disabled) => {
  if (disabled) {
    showInputActionMenu.value = false;
  }
});

onBeforeUnmount(() => {
  clearSelectorInteractionResetTimer();
});

const clearAgentChoice = () => {
  if (isInputControlsDisabled.value) return;
  emit('update:agent-choice', null);
};

// 当用户在模型下拉框中选择模型时，向父组件抛出更新事件
const handlePrimaryModelChange = (value: string | null) => {
  if (isInputControlsDisabled.value) return;
  if (value === MANAGE_CONVERSATION_MODELS_VALUE) {
    emit('manage-models');
    return;
  }
  emit('update:primaryModelValue', value);
};

const handleSubmit = () => {
  emit('submit');
};
</script>
