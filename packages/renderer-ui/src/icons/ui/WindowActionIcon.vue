<template>
  <!-- 最小化图标 -->
  <svg class="shared-icon shared-icon--em" v-if="action === 'minimize'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path d="M5.5,11.5h13c.28,0,.5.22.5.5h0c0,.28-.22.5-.5.5H5.5c-.28,0-.5-.22-.5-.5h0c0-.28.22-.5.5-.5Z" fill="currentColor" stroke-width="0"/>
  </svg>

  <!-- 最大化/恢复图标 -->
  <template v-else-if="action === 'maximize'">
    <!-- 最大化图标 -->
    <svg class="shared-icon shared-icon--em" v-if="!isMaximized" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M5,7c0-1.1.9-2,2-2h10c1.1,0,2,.9,2,2v10c0,1.1-.9,2-2,2H7c-1.1,0-2-.9-2-2V7ZM7,6c-.55,0-1,.45-1,1v10c0,.55.45,1,1,1h10c.55,0,1-.45,1-1V7c0-.55-.45-1-1-1H7Z" fill="currentColor" stroke-width="0"/>
    </svg>
    
    <!-- 恢复图标 -->
    <svg class="shared-icon shared-icon--em" v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M8.09,6h-1.03c.24-1.16,1.26-2,2.45-2h6.5c2.21,0,4,1.79,4,4v6.5c0,1.19-.84,2.21-2,2.45v-1.03c.6-.21,1-.78,1-1.41v-6.5c0-1.66-1.34-3-3-3h-6.5c-.64,0-1.2.4-1.41,1ZM6.5,7c-1.38,0-2.5,1.12-2.5,2.5v8c0,1.38,1.12,2.5,2.5,2.5h8c1.38,0,2.5-1.12,2.5-2.5v-8c0-1.38-1.12-2.5-2.5-2.5H6.5ZM5,9.5c0-.83.67-1.5,1.5-1.5h8c.83,0,1.5.67,1.5,1.5v8c0,.83-.67,1.5-1.5,1.5H6.5c-.83,0-1.5-.67-1.5-1.5v-8Z" fill="currentColor" stroke-width="0"/>
    </svg>
  </template>
</template>

<script setup lang="ts">
defineProps({
  action: {
    type: String,
    required: true,
    validator: (value: string) => ['minimize', 'maximize'].includes(value)
  },
  isMaximized: {
    type: Boolean,
    default: false
  }
});
</script>
