<!-- packages/renderer-ui/src/icons/ui/MoreIcon.vue -->
<template>
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- 横向：三个水平点 -->
    <template v-if="direction === 'horizontal'">
      <circle cx="6" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="18" cy="12" r="1.5" fill="currentColor"/>
    </template>
    
    <!-- 纵向：三个垂直点 -->
    <template v-else>
      <circle cx="12" cy="6" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="18" r="1.5" fill="currentColor"/>
    </template>
  </svg>
</template>

<script setup lang="ts">
// 三个点的"更多"图标，支持横向和纵向
defineProps({
  direction: {
    type: String,
    default: 'vertical', // 'vertical' | 'horizontal'
    validator: (value: string) => ['vertical', 'horizontal'].includes(value)
  }
});
</script>
