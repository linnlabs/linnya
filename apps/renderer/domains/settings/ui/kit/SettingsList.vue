<!--
  apps/renderer/domains/settings/ui/kit/SettingsList.vue

  带边框的条目列表容器（模型列表、对话工作文件列表、插件列表）。
  内部条目用 SettingsListRow。
-->
<template>
  <div class="settings-list" :class="{ 'is-borderless': !bordered }">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 无边框列表用于导航 Tab 和 hover 卡片，条目只通过背景反馈交互。 */
    bordered?: boolean;
  }>(),
  {
    bordered: true,
  }
);
</script>
