<template>
  <input
    ref="inputRef"
    class="linnya-inline-input"
    :class="`linnya-inline-input--${variant}`"
    type="text"
    :value="modelValue"
    :placeholder="placeholder"
    @input="handleInput"
    @keydown="handleKeydown"
    @focus="settled = false"
    @blur="handleBlur"
    @pointerdown.stop
    @click.stop
  />
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { InlineTextInputVariant } from '../definitions/inlineTextInput';

/**
 * 就地编辑框：在原文字的位置改一段短文本（重命名、连线标签等）。回车与失焦提交，Esc 取消；
 * 输入法组字时的回车与 Esc 留给输入法。键盘事件不再冒泡，宿主快捷键不会在编辑中触发。
 */
const props = withDefaults(
  defineProps<{
    readonly modelValue: string;
    /** inline 嵌在列表行里，与被替换的文字对齐；floating 浮在画布等内容上，随文字伸缩并带浮层阴影。 */
    readonly variant?: InlineTextInputVariant;
    readonly placeholder?: string;
    /** 挂载即聚焦并全选；打开前需要等菜单等收起焦点的宿主可关掉，再调用暴露的 focus/select。 */
    readonly autofocus?: boolean;
  }>(),
  { variant: 'inline', placeholder: '', autofocus: true }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  commit: [value: string];
  cancel: [];
}>();

const inputRef = ref<HTMLInputElement | null>(null);
/**
 * 一次编辑只结束一次：回车提交后宿主卸载或移走焦点触发的失焦不再重复提交。
 * 宿主保存失败而保留编辑框时，用户再改字或重新聚焦即可再次提交。
 */
const settled = ref(false);

function finish(kind: 'commit' | 'cancel'): void {
  if (settled.value) return;
  settled.value = true;
  if (kind === 'commit') emit('commit', inputRef.value?.value ?? props.modelValue);
  else emit('cancel');
}

function handleInput(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  settled.value = false;
  emit('update:modelValue', event.target.value);
}

function handleKeydown(event: KeyboardEvent): void {
  event.stopPropagation();
  // macOS Chromium 的组字回车仍报 key=Enter，只能靠 isComposing / 229 区分。
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    finish('commit');
  } else if (event.key === 'Escape') {
    event.preventDefault();
    finish('cancel');
  }
}

function handleBlur(): void {
  finish('commit');
}

function focus(): void {
  inputRef.value?.focus();
}

function select(): void {
  inputRef.value?.select();
}

onMounted(() => {
  if (!props.autofocus) return;
  focus();
  select();
});

defineExpose({ focus, select });
</script>
