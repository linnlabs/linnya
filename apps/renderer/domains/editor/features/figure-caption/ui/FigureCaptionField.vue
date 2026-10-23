<template>
  <div
    class="figure-caption-field"
    :class="{ 'is-editable': editable, 'is-editing': editing }"
    contenteditable="false"
    @keydown.stop
    @mousedown.stop
  >
    <CustomTextarea
      v-if="editing"
      ref="input"
      v-model="draft"
      :rows="1"
      auto-grow
      :bordered="false"
      control-class="figure-caption-field__input"
      :aria-label="label"
      :aria-invalid="invalid || undefined"
      @keydown="keydown"
      @blur="blur"
      @compositionstart="composing = true"
      @compositionend="endComposition"
    />
    <p
      v-else-if="value"
      class="figure-caption-field__text"
      :tabindex="editable ? 0 : undefined"
      :role="editable ? 'button' : undefined"
      :aria-label="editable ? label : undefined"
      @click.stop="begin"
      @keydown.enter.prevent="begin"
      @keydown.space.prevent="begin"
    >
      {{ value }}
    </p>
    <p
      v-if="editing && invalid"
      class="figure-caption-field__error"
      role="alert"
    >
      {{ editorMessage('editor.figureCaption.invalid', { limit }) }}
    </p>
    <p
      v-if="conflict"
      class="figure-caption-field__error"
      role="status"
    >
      {{ editorMessage('editor.figureCaption.conflict') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, toRef } from 'vue';
import { CustomTextarea } from '@linnya/renderer-ui';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import { useFigureCaptionDraft } from '../orchestration/useFigureCaptionDraft';

const props = withDefaults(
  defineProps<{
    value: string;
    version: string;
    editable: boolean;
    label: string;
    limit?: number;
  }>(),
  { limit: 200 }
);
const emit = defineEmits<{ commit: [value: string, version: string]; active: [active: boolean] }>();
const input = ref<{ focus: () => void } | null>(null);
const { editorMessage } = useEditorLocalization();
const state = useFigureCaptionDraft({
  value: toRef(props, 'value'),
  version: toRef(props, 'version'),
  editable: toRef(props, 'editable'),
  limit: toRef(props, 'limit'),
  commit: (value, version) => emit('commit', value, version),
  active: active => emit('active', active),
});
const { editing, draft, composing, conflict, invalid, blur, endComposition, keydown } = state;
async function begin() {
  if (state.begin()) {
    await nextTick();
    input.value?.focus();
  }
}
onBeforeUnmount(state.cancel);
defineExpose({ begin });
</script>
