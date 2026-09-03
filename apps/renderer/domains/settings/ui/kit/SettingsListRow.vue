<!--
  apps/renderer/domains/settings/ui/kit/SettingsListRow.vue

  列表条目：左侧标题 + 副标题 / 标记，右侧操作区。
  interactive 为 true 时主内容可点；存在 trailing 控件时，两者保持独立交互。
-->
<template>
  <component
    :is="interactive && !$slots.trailing ? 'button' : 'div'"
    class="settings-list-row"
    :class="{
      'is-interactive': interactive,
      'has-trailing': Boolean($slots.trailing),
    }"
    :type="interactive && !$slots.trailing ? 'button' : undefined"
    @click="interactive && !$slots.trailing ? emit('select') : undefined"
  >
    <component
      :is="interactive && $slots.trailing ? 'button' : 'span'"
      class="settings-list-row-main"
      :class="{ 'is-interactive': interactive && Boolean($slots.trailing) }"
      :type="interactive && $slots.trailing ? 'button' : undefined"
      @click="interactive && $slots.trailing ? emit('select') : undefined"
    >
      <span class="settings-list-row-title">
        <slot name="title">
          {{ title }}
        </slot>
      </span>
      <span v-if="meta || $slots.meta" class="settings-list-row-meta">
        <slot name="meta">
          {{ meta }}
        </slot>
      </span>
    </component>
    <span v-if="$slots.trailing" class="settings-list-row-trailing">
      <slot name="trailing" />
    </span>
  </component>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
  /** 标题右侧的次要信息或状态标记。 */
  meta?: string;
  /** 整行可点击。 */
  interactive?: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>
