<!--
  apps/renderer/domains/settings/ui/kit/SettingsPage.vue

  设置 tab 的根容器。页面标题由设置壳层的面板头承担，这里只负责内容列
  与可选的导语。所有设置 tab 都应该以它作为根节点。
-->
<template>
  <div class="settings-tab-content settings-page">
    <p
      v-if="description"
      class="settings-page-description"
    >
      {{ description }}
    </p>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** 页面导语，放在第一个分区之前。 */
  description?: string;
}>();
</script>
