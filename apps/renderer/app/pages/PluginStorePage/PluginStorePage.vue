<!--
  apps/renderer/app/pages/PluginStorePage/PluginStorePage.vue

  插件页面：只负责装配 plugin-store domain 的整页视图。
-->
<template>
  <div class="main-flow">
    <div class="page-main-content">
      <PluginStoreView />
    </div>
  </div>
</template>

<script setup lang="ts">
import PluginStoreView from '@/domains/plugin-store/ui/PluginStoreView.vue';
</script>
