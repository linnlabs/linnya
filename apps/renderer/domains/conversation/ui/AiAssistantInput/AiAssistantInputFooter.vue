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
          <IconButton
            ref="inputActionMenuButtonComponentRef"
            class="input-action-menu-button"
            :size="variant === 'compact' ? 'sm' : 'composer'"
            :label="conversationMessage('conversation.input.actionMenu.open')"
            :disabled="isInputControlsDisabled"
            aria-haspopup="menu"
            :aria-expanded="showInputActionMenu"
            @click="toggleInputActionMenu"
            @keydown.down.prevent="openInputActionMenu"
            @keydown.up.prevent="openInputActionMenu"
          >
            <AddIcon />
          </IconButton>

          <Teleport to="body">
            <transition name="ai-assistant-input-action-menu-fade">
              <div
                v-show="showInputActionMenu"
                ref="inputActionMenuWrapperRef"
                :style="inputActionMenuStyle"
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

        <!-- 命令档位属于对话：紧跟“+”，在 Agent 与模型选择左边，只显示档位图标。 -->
        <div v-if="$slots['command-permission']" class="selector-group selector-group--command-permission">
          <slot name="command-permission" />
        </div>

        <!-- 增删 Agent 时胶囊展开、收起，右侧的模型选择器随之平滑移动；收起期间沿用最后一次的内容。 -->
        <Transition name="agent-choice-slot">
        <div v-if="hasAgentChoice && shownAgentChoice" class="agent-choice-slot">
        <div class="agent-choice-slot__inner">
        <div class="selector-group selector-group--agent-choice">
          <div
            class="select-trigger select-trigger--minimal agent-choice-trigger"
            :class="{
              'is-disabled': isInputControlsDisabled,
              'is-unavailable': shownAgentChoice.unavailable,
            }"
            role="button"
            :aria-label="shownAgentChoice.ariaLabel"
            :title="shownAgentChoice.ariaLabel"
          >
            <button
              type="button"
              class="agent-choice-trigger-close"
              :disabled="isInputControlsDisabled"
              @click.stop="clearAgentChoice"
              :aria-label="conversationMessage('conversation.input.agentChoice.closeCurrent')"
              :data-linnya-tooltip="conversationMessage('conversation.input.agentChoice.close')"
            >
              <component
                :is="shownAgentChoice.icon"
                v-if="shownAgentChoice.icon"
                class="agent-choice-trigger-icon agent-choice-trigger-icon--default"
              />
              <CloseIcon class="agent-choice-trigger-icon agent-choice-trigger-icon--hover" />
            </button>
            <span class="agent-choice-trigger-text">{{ shownAgentChoice.text }}</span>
          </div>
        </div>
        </div>
        </div>
        </Transition>

        <!-- 模型选择跟随输入能力放在左侧，较长名称在窄窗口中优先省略。 -->
        <div class="selector-group selector-group--model">
          <CustomSelect
            class="input-footer-model-select"
            :model-value="primaryModelValue"
            :options="modelSelectOptions"
            @update:modelValue="handlePrimaryModelChange"
            :placeholder="
              isModelsLoading
                ? conversationMessage('conversation.input.model.loading')
                : conversationMessage('conversation.input.model.placeholder')
            "
            :disabled="isModelsLoading || isInputControlsDisabled"
            variant="minimal"
            :bordered="false"
            font-size="12px"
            option-label-overflow="marquee-on-hover"
            :show-option-label-tooltip="false"
            options-motion-direction="up"
            :class-names="{
              trigger: 'input-footer-model-trigger',
              selectedValue: 'input-footer-model-selected-value',
              options: 'input-footer-model-options',
              optionsHeader: 'input-footer-model-options-header',
            }"
          >
            <template #arrow-icon="{ isOpen }">
              <ChevronIcon direction="up" class="selector-chevron" :class="{ 'is-open': isOpen }" />
            </template>
          </CustomSelect>
        </div>
      </div>
    </div>

    <div class="ai-assistant-input-footer__primary-actions">
      <!-- 新对话还没有上下文可算，不显示用量环。 -->
      <ContextWindowUsageDropdown
        v-if="contextWindowUsageScopeKey"
        :key="contextWindowUsageScopeKey"
        :presentation="contextWindowUsage"
        :conversation-information="contextWindowConversationInformation"
      />

      <button
        :class="['send-button', { disabled: isPrimaryActionDisabled, 'is-running': primaryAction !== 'send' }]"
        :disabled="isPrimaryActionDisabled"
        :aria-label="conversationMessage(`conversation.input.action.${primaryAction}`)"
        :data-linnya-tooltip="conversationMessage(`conversation.input.action.${primaryAction}`)"
        @click="handleSubmit"
      >
        <!-- 发送 / 暂停 / 继续共用一个图标，状态切换时由图标自己完成形变 -->
        <RunControlIcon :action="primaryAction" class="send-button__icon" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, ref, watch } from 'vue';
import type { PropType, Component } from 'vue';
import { CustomSelect, IconButton, useAnchoredPosition } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { RunControlIcon } from '@linnya/renderer-ui/icons';
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
import type { ComposerRunAction } from '../../features/interactive-run';
import {
  CONVERSATION_IMAGE_ATTACHMENT_MENU_VALUE,
  buildConversationInputActionMenuOptions,
  readConversationAgentMenuValue,
  type ConversationInputActionMenuOption,
} from '../../features/input-action-menu';

const props = defineProps({
  primaryAction: { type: String as PropType<ComposerRunAction>, required: true },
  isPrimaryActionDisabled: { type: Boolean, required: true },
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
  isActiveAgentChoiceUnavailable: { type: Boolean, default: false },
  primaryModelValue: {
    type: String as PropType<string | null>,
    default: null,
  },
  modelSelectOptions: {
    type: Array as PropType<ModelSelectOption[]>,
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
  /** 当前对话 ID；新对话为 null，此时不显示用量环。 */
  contextWindowUsageScopeKey: {
    type: String as PropType<string | null>,
    default: null,
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
const isInputControlsDisabled = computed(() => props.disabled);

const inputActionMenuOptions = computed<ConversationInputActionMenuOption[]>(() => {
  const agents = conversationAgentChoices.value.filter(agentChoice => !agentChoice.menuHidden).map(agentChoice => {
    const agentChoiceText = resolveConversationAgentChoiceTextPresentation(agentChoice, t);
    return {
      id: agentChoice.id,
      label: agentChoiceText.menuText,
      disabled: agentChoice.disabled === true || props.activeAgentChoiceId === agentChoice.id,
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
  return (
    conversationAgentChoices.value.find(agentChoice => agentChoice.id === props.activeAgentChoiceId)
      ?.iconComponent ?? null
  );
});

interface ShownAgentChoice {
  readonly text: string;
  readonly ariaLabel: string;
  readonly icon: Component | null;
  readonly unavailable: boolean;
}

const hasAgentChoice = computed(() => Boolean(props.activeAgentChoicePillText && props.activeAgentChoiceAriaLabel));
/** 胶囊显示的内容：有 Agent 时跟随最新值；关闭后保留最后一次，让收起动画期间文字不消失。 */
const shownAgentChoice = ref<ShownAgentChoice | null>(null);
watch(
  () => [props.activeAgentChoicePillText, props.activeAgentChoiceAriaLabel, activeAgentChoiceIconComponent.value, props.isActiveAgentChoiceUnavailable] as const,
  ([text, ariaLabel, icon, unavailable]) => {
    if (!text || !ariaLabel) return;
    shownAgentChoice.value = { text, ariaLabel, icon: icon ? markRaw(icon) : null, unavailable };
  },
  { immediate: true },
);

const showInputActionMenu = ref(false);
const inputActionMenuButtonComponentRef = ref<InstanceType<typeof IconButton> | null>(null);
const inputActionMenuButtonRef = computed<HTMLElement | null>(() => inputActionMenuButtonComponentRef.value?.element ?? null);
const inputActionMenuWrapperRef = ref<HTMLElement | null>(null);
// 输入区在窗口底部：菜单默认在按钮上方，放不下才翻到下方。
const { style: inputActionMenuStyle } = useAnchoredPosition({
  anchor: inputActionMenuButtonRef,
  floating: inputActionMenuWrapperRef,
  open: showInputActionMenu,
  placement: { side: 'top' },
});
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

watch(isInputControlsDisabled, disabled => {
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
