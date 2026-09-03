<template>
  <div v-if="title || description" class="ask-questionnaire-header questionnaire-header">
    <h3 v-if="title" class="questionnaire-title">
      {{ title }}
    </h3>
    <p v-if="description" class="questionnaire-description">
      {{ description }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 问卷头部：只负责展示标题/描述，不承载任何状态。
 *
 * 说明：
 * - 用户反馈“问卷不需要分界线”，因此去掉了 header 底部边线；
 * - 外层 tool-card 的边框/背景也由 registry layout 统一关闭。
 */
defineProps<{
  title?: string;
  description?: string;
}>();
</script>
