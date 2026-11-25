<template>
  <Modal
    ref="modalRef"
    :is-visible="visible"
    :title="resolvedTitle"
    :width="width"
    :max-width="maxWidth"
    min-height="auto"
    layer="alert"
    scroll-mode="internal"
    @close="onClose"
  >
    <div class="alert-dialog-content">
      <div class="alert-dialog-copy" data-linnya-scrollbar="large">
        <div class="alert-dialog-message">{{ message }}</div>

        <div
          v-if="sections.length > 0"
          class="alert-dialog-sections"
        >
          <section
            v-for="section in sections"
            :key="section.title"
            class="alert-dialog-section"
          >
            <h4>{{ section.title }}</h4>
            <ul>
              <li
                v-for="item in section.items"
                :key="item"
              >
                {{ item }}
              </li>
            </ul>
          </section>
        </div>

        <p
          v-if="riskMessage"
          class="alert-dialog-risk-message"
        >
          {{ riskMessage }}
        </p>
      </div>
    </div>

    <template #footer>
      <div class="alert-dialog-footer">
        <ActionButtons
          v-if="isConfirmation"
          :secondary-action-text="resolvedCancelText"
          :primary-action-text="resolvedConfirmText"
          :primary-variant="dangerousActionResolved ? 'danger' : 'default'"
          :primary-button-attributes="alertActionButtonAttributes"
          :secondary-button-attributes="alertActionButtonAttributes"
          @secondary-click="onCancel"
          @primary-click="onConfirm"
        />
        <ActionButtons
          v-else
          :primary-action-text="resolvedConfirmText"
          :primary-variant="dangerousActionResolved ? 'danger' : 'default'"
          :primary-button-attributes="alertActionButtonAttributes"
          @primary-click="onConfirm"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue';
import { ActionButtons } from '../../actions';
import { useSharedComponentLocalization } from '../../../localization';
import type { AlertDialogProps } from '../definitions/alertDialog';
import { resolveAlertDialogDangerousAction } from '../functions/resolveAlertDialogDangerousAction';
import Modal from './Modal.vue';

const props = withDefaults(defineProps<AlertDialogProps>(), {
  visible: false,
  message: '',
  sections: () => [],
  riskMessage: '',
  isConfirmation: false,
  title: '',
  confirmText: '',
  cancelText: '',
  isDangerousAction: false,
  closeIsCancel: true,
  defaultAction: 'confirm',
  width: '400px',
  maxWidth: '90%',
});

const emit = defineEmits<{
  close: [];
  confirm: [];
  cancel: [];
}>();

const modalRef = useTemplateRef('modalRef');
const { sharedComponentMessage } = useSharedComponentLocalization();
const alertActionButtonAttributes = Object.freeze({ class: 'alert-dialog-action' });

const resolvedTitle = computed(() => props.title || sharedComponentMessage('shared.alert.title'));
const resolvedConfirmText = computed(() => (
  props.confirmText || sharedComponentMessage('shared.alert.confirm')
));
const resolvedCancelText = computed(() => (
  props.cancelText || sharedComponentMessage('shared.alert.cancel')
));
const dangerousActionResolved = computed(() => resolveAlertDialogDangerousAction({
  confirmText: resolvedConfirmText.value,
  title: resolvedTitle.value,
  isDangerousAction: props.isDangerousAction,
}));

const onClose = (): void => {
  if (props.isConfirmation && props.closeIsCancel) {
    emit('cancel');
  } else {
    emit('close');
  }
};

const onConfirm = (): void => {
  if (props.isConfirmation) {
    emit('confirm');
  } else {
    emit('close');
  }
};

const onCancel = (): void => {
  emit('cancel');
};

// Escape 由内层 Modal 的 Escape 归属处理，每次按键只关闭一次；这里只处理 Enter 的默认操作。
// 焦点已经移到“取消”等按钮上时，Enter 按的是那个按钮；确认框叠确认框时只有最上面的响应。
const handleKeyDown = (event: KeyboardEvent): void => {
  if (!props.visible || event.key !== 'Enter' || !modalRef.value?.isTopmost()) return;
  if (event.target instanceof Element && event.target.closest('.modal-container button')) return;
  event.preventDefault();
  if (props.isConfirmation && props.defaultAction === 'cancel') onCancel();
  else onConfirm();
};

// 迁移期保持既有监听时机，不在 owner 迁移中改变键盘交互。
watch(() => props.visible, (newValue) => {
  if (newValue) {
    document.addEventListener('keydown', handleKeyDown);
  } else {
    document.removeEventListener('keydown', handleKeyDown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown);
});
</script>
