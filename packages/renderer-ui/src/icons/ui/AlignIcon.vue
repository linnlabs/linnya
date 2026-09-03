<!-- packages/renderer-ui/src/icons/ui/AlignIcon.vue -->
<!-- 该文件是"对齐"操作的SVG图标组件，支持左对齐、居中对齐和右对齐三种模式 -->
<template>
  <svg class="shared-icon shared-icon--full" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <!-- 左对齐 -->
    <path v-if="alignment === 'left'" d="M4,7c0-.28.22-.5.5-.5h11c.28,0,.5.22.5.5s-.22.5-.5.5H4.5c-.28,0-.5-.22-.5-.5ZM4,12c0-.28.22-.5.5-.5h15c.28,0,.5.22.5.5s-.22.5-.5.5H4.5c-.28,0-.5-.22-.5-.5ZM4.5,16.5c-.28,0-.5.22-.5.5s.22.5.5.5h9c.28,0,.5-.22.5-.5s-.22-.5-.5-.5H4.5Z" fill="currentColor" stroke-width="0"/>
    
    <!-- 居中对齐 -->
    <path v-else-if="alignment === 'center'" d="M6,7c0-.28.22-.5.5-.5h11c.28,0,.5.22.5.5s-.22.5-.5.5H6.5c-.28,0-.5-.22-.5-.5ZM4,12c0-.28.22-.5.5-.5h15c.28,0,.5.22.5.5s-.22.5-.5.5H4.5c-.28,0-.5-.22-.5-.5ZM8.5,16.5c-.28,0-.5.22-.5.5s.22.5.5.5h7c.28,0,.5-.22.5-.5s-.22-.5-.5-.5h-7Z" fill="currentColor" stroke-width="0"/>
    
    <!-- 右对齐 -->
    <path v-else-if="alignment === 'right'" d="M8,7c0-.28.22-.5.5-.5h11c.28,0,.5.22.5.5s-.22.5-.5.5h-11c-.28,0-.5-.22-.5-.5ZM4,12c0-.28.22-.5.5-.5h15c.28,0,.5.22.5.5s-.22.5-.5.5H4.5c-.28,0-.5-.22-.5-.5ZM11.5,16.5c-.28,0-.5.22-.5.5s.22.5.5.5h8c.28,0,.5-.22.5-.5s-.22-.5-.5-.5h-8Z" fill="currentColor" stroke-width="0"/>
  </svg>
</template>

<script setup lang="ts">
/**
 * 功能 (What): 对齐图标组件，根据 alignment 属性显示不同的对齐图标（左对齐、居中对齐、右对齐）
 * 输入 (Input / @param): 
 *   - alignment: 'left' | 'center' | 'right' - 对齐方式
 * 输出 (Output): 渲染对应的 SVG 图标
 * 副作用 (Side-effects): 无
 */
defineProps({
  alignment: {
    type: String,
    required: true,
    validator: (value: string) => ['left', 'center', 'right'].includes(value)
  }
});
</script>
