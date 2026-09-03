<template>
  <div class="document-surface__unavailable" role="status">
    <div class="document-surface__unavailable-panel">
      <div class="document-surface__unavailable-title">{{ title }}</div>
      <p class="document-surface__unavailable-message">{{ message }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  message: string;
}>();
</script>
