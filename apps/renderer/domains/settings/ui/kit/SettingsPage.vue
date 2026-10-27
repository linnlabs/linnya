<!--
  apps/renderer/domains/settings/ui/kit/SettingsPage.vue

  设置 tab 的根容器。页面标题由设置壳层的面板头承担，这里只负责内容列
  与可选的导语；contribution 声明 headerMode='page' 时可由这里拥有标题和操作区。
  所有设置 tab 都应该以它作为根节点。
-->
<template>
  <div class="settings-tab-content settings-page">
    <header
      v-if="title"
      class="settings-page-header"
    >
      <h2 class="settings-page-title">
        {{ title }}
      </h2>
      <div
        v-if="$slots.actions"
        class="settings-page-actions"
      >
        <slot name="actions" />
      </div>
    </header>
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
  /** 页面拥有页头时传入；设置 contribution 需要同时声明 headerMode='page'。 */
  title?: string;
  /** 页面导语，放在第一个分区之前。 */
  description?: string;
}>();
</script>
