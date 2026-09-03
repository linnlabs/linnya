<!--
  apps/renderer/domains/settings/ui/kit/SettingsRow.vue

  设置行：左侧标签 + 说明，右侧控件。件套里唯一的表单行原语，
  控件本身使用 Renderer UI 的公开通用控件，
  这里只负责两列的宽度、对齐与节奏。
-->
<template>
  <div
    class="settings-row"
    :class="[`is-control-${control}`, `is-align-${align}`]"
  >
    <div class="settings-row-label-area">
      <component
        :is="labelFor ? 'label' : 'span'"
        v-if="label || $slots.label"
        class="settings-row-label"
        :for="labelFor"
      >
        <slot name="label">
          {{ label }}
        </slot>
      </component>
      <p
        v-if="description || $slots.description"
        class="settings-row-description"
      >
        <slot name="description">
          {{ description }}
        </slot>
      </p>
    </div>

    <div class="settings-row-control">
      <slot />
      <p
        v-if="hint || $slots.hint"
        class="settings-row-hint"
      >
        <slot name="hint">
          {{ hint }}
        </slot>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SettingsRowAlign, SettingsRowControl } from '../../definitions/settingsKit';

withDefaults(defineProps<{
  label?: string;
  /** 说明文字，跟在标签下方。开关行的说明一律放这里，不要放到控件列。 */
  description?: string;
  /** 控件下方的补充说明，用于「选了什么会怎样」这类跟控件强相关的提示。 */
  hint?: string;
  /** 传入受控控件的 id，标签会渲染成 <label for>。 */
  labelFor?: string;
  control?: SettingsRowControl;
  align?: SettingsRowAlign;
}>(), {
  label: undefined,
  description: undefined,
  hint: undefined,
  labelFor: undefined,
  control: 'fill',
  align: 'top',
});
</script>
