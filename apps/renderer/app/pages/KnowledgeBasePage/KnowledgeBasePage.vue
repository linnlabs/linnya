<!--
  apps/renderer/app/pages/KnowledgeBasePage/KnowledgeBasePage.vue
  
  知识库页面：组装 KnowledgeBase 领域组件。
  负责渲染知识库列表及详情视图。
-->
<template>
  <div class="main-flow">
    <KnowledgeBaseView />
  </div>
</template>

<script setup lang="ts">
import KnowledgeBaseView from '@/domains/knowledgebase/ui/page/KnowledgeBaseView.vue';
</script>

