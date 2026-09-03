<!--
  apps/renderer/app/pages/MindmapPage/MindmapPage.vue
  
  思维导图页面：组装 MindMap 领域组件。
  负责渲染思维导图视图。
-->
<template>
  <MindMapView />
</template>

<script setup lang="ts">
// 思维导图主体由插件包 renderer domain 提供，这里只是页面壳。
import MindMapView from '../ui/MindMapView.vue';
</script>
