<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { IconButton } from '@linnya/renderer-ui';
import { AddIcon, ChevronIcon, RunControlIcon } from '@linnya/renderer-ui/icons';

/**
 * 对话输入框的静态外壳：尺寸、圆角、底栏控件高度照真实输入框（AiAssistantInput）抄，
 * 用来摆放档位指示、插话等方案，不含真实编辑器与发送逻辑。
 */
const props = withDefaults(
  defineProps<{
    readonly variant?: 'default' | 'compact';
    readonly placeholder?: string;
    readonly model?: string;
    readonly running?: boolean;
    /** 草稿文字；运行中有草稿时，底栏同时给出暂停和发送。 */
    readonly draft?: string;
    /** 编辑区可输入（插话预览用）：回车发送，Shift+回车换行。 */
    readonly editable?: boolean;
    /** 正在等用户批准或填写表单：没有草稿时主按钮是禁用的“恢复”，与现在一致。 */
    readonly awaitingUser?: boolean;
  }>(),
  {
    variant: 'default',
    placeholder: '输入消息，@ 引用文档',
    model: 'DeepSeek V4',
    running: false,
    draft: '',
    editable: false,
    awaitingUser: false,
  },
);

const emit = defineEmits<{
  'update:draft': [value: string];
  send: [];
  pause: [];
}>();

defineSlots<{
  above(): unknown;
  'footer-extra'(): unknown;
  below(): unknown;
}>();

const hasDraft = computed(() => props.draft.trim().length > 0);
const showPause = computed(() => props.running && hasDraft.value);
const mainAction = computed(() => {
  if (hasDraft.value || !props.running) return 'send';
  return props.awaitingUser ? 'resume' : 'pause';
});
const mainDisabled = computed(() => mainAction.value === 'resume');

const editorRef = ref<HTMLTextAreaElement | null>(null);

/** 把光标放到草稿末尾（编辑待送达的消息时用）。 */
async function focusEnd() {
  await nextTick();
  const editor = editorRef.value;
  if (!editor) return;
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}

defineExpose({ focusEnd });

function onInput(event: Event) {
  if (event.target instanceof HTMLTextAreaElement) emit('update:draft', event.target.value);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (hasDraft.value) emit('send');
}

function onMainAction() {
  if (mainDisabled.value) return;
  if (mainAction.value === 'pause') emit('pause');
  else if (hasDraft.value) emit('send');
}
</script>

<template>
  <div class="mock-composer" :class="`is-${variant}`">
    <slot name="above" />
    <div class="mock-composer__surface">
      <textarea
        v-if="editable"
        ref="editorRef"
        class="mock-composer__editor is-editable"
        rows="1"
        :value="draft"
        :placeholder="placeholder"
        aria-label="消息"
        @input="onInput"
        @keydown="onKeydown"
      />
      <div v-else class="mock-composer__editor" :class="{ 'has-draft': hasDraft }">{{ hasDraft ? draft : placeholder }}</div>
      <div class="mock-composer__footer">
        <div class="mock-composer__controls">
          <IconButton :size="variant === 'compact' ? 'sm' : 'composer'" label="添加">
            <AddIcon />
          </IconButton>
          <span class="mock-composer__model">
            <span class="mock-composer__model-text">{{ model }}</span>
            <ChevronIcon direction="up" class="mock-composer__chevron" />
          </span>
          <slot name="footer-extra" />
        </div>
        <div class="mock-composer__actions">
          <span class="mock-composer__usage" aria-hidden="true" />
          <IconButton
            v-if="showPause"
            class="mock-composer__pause"
            :size="variant === 'compact' ? 'sm' : 'composer'"
            label="暂停"
            @click="emit('pause')"
          >
            <RunControlIcon action="pause" />
          </IconButton>
          <button
            type="button"
            class="mock-composer__send"
            :class="{ 'is-disabled': mainDisabled }"
            :disabled="mainDisabled"
            :aria-label="mainAction === 'pause' ? '暂停' : mainAction === 'resume' ? '恢复' : '发送'"
            @click="onMainAction"
          >
            <RunControlIcon :action="mainAction" />
          </button>
        </div>
      </div>
    </div>
    <slot name="below" />
  </div>
</template>

<style scoped>
.mock-composer {
  --mock-composer-radius: 28px;
  --mock-composer-control-height: 26px;

  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
}

.mock-composer.is-compact {
  --mock-composer-radius: 21px;
  --mock-composer-control-height: 24px;
}

.mock-composer__surface {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  border: 0.5px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
  border-radius: var(--mock-composer-radius);
  corner-shape: squircle;
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm);
}

.mock-composer__editor {
  min-height: 34px;
  padding: var(--space-3) var(--space-4) var(--space-0-5);
  color: var(--color-text-placeholder);
  font-size: var(--font-size-prose);
  line-height: 24px;
}

.mock-composer__editor.has-draft {
  color: var(--color-text-primary);
  white-space: pre-wrap;
}

.mock-composer__editor.is-editable {
  box-sizing: content-box;
  height: 24px;
  margin: 0;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--color-text-primary);
  font-family: inherit;
}

.mock-composer__editor.is-editable::placeholder {
  overflow: hidden;
  color: var(--color-text-placeholder);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.is-compact .mock-composer__editor {
  min-height: 28px;
  padding: var(--space-2-5) var(--space-2-5) 0;
  font-size: var(--font-size-body);
}

.is-compact .mock-composer__editor.is-editable {
  min-height: 0;
  height: 24px;
}

.mock-composer__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2-5) var(--space-2) var(--space-2);
}

.is-compact .mock-composer__footer {
  padding: var(--space-1-5) var(--space-2-5) var(--space-2);
}

.mock-composer__controls {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.is-compact .mock-composer__controls {
  gap: var(--space-1);
}

.mock-composer__model {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  height: var(--mock-composer-control-height);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.mock-composer__model-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mock-composer__chevron {
  flex: none;
  width: 12px;
  height: 12px;
}

.mock-composer__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
}

.mock-composer__usage {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--color-border-default);
  border-radius: 50%;
}

.mock-composer__pause :deep(svg) {
  width: 14px;
  height: 14px;
}

.mock-composer__send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background-color: var(--color-bg-inverse);
  color: var(--color-text-inverse);
  cursor: pointer;
}

.mock-composer__send.is-disabled {
  opacity: 0.35;
  cursor: default;
}

.is-compact .mock-composer__send {
  width: 24px;
  height: 24px;
}

.mock-composer__send :deep(svg) {
  width: 14px;
  height: 14px;
}
</style>
