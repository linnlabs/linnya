<!-- packages/renderer-ui/src/icons/ui/LinnyaIcon.vue -->
<!-- Linnya 图标组件：右叶（茎进入叶片后变为留白叶脉）、收尖的茎、左叶，三部分互不相连。 -->
<template>
  <svg
    class="shared-icon shared-icon--em linnya-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 标准稿：32px 及以上 -->
    <path
      v-if="variant === 'display'"
      d="M12.18 13C10.78 9.37 12.65 6.05 18.33 2.04C17.99 8.85 16.33 12.29 12.82 13.38C13.29 11.46 14.25 9.01 15.66 6.6C14.09 8.81 12.91 11.11 12.18 13ZM10.1 22.3C9.9 20.44 10.41 18.54 10.89 16.75C11.18 15.66 11.65 14.59 12.34 13.69C12.44 14.83 12.07 15.97 11.64 17.01C10.95 18.72 10.33 20.46 10.1 22.3ZM11.4 13.4C8.22 13.61 5.8 12.03 4.27 8.77C8.01 8.63 10.43 10.2 11.4 13.4Z"
      fill="currentColor"
    />

    <!-- 小尺寸稿：茎与叶脉加粗，保证 24px 以下仍可辨认 -->
    <path
      v-else
      d="M12.1 12.75C10.87 9.22 12.78 5.96 18.33 2.04C17.99 8.72 16.39 12.16 13.02 13.32C13.44 11.41 14.32 8.99 15.66 6.6C14.09 8.71 12.89 10.91 12.1 12.75ZM10.1 22.3C9.79 20.46 10.26 18.54 10.68 16.75C10.94 15.64 11.47 14.57 12.32 13.79C12.6 14.92 12.28 16.11 11.81 17.14C11.06 18.8 10.43 20.5 10.1 22.3ZM11.4 13.4C8.22 13.61 5.8 12.03 4.27 8.77C8.01 8.63 10.43 10.2 11.4 13.4Z"
      fill="currentColor"
    />
  </svg>
</template>

<script setup lang="ts">
/**
 * 功能 (What): Linnya 图标，按 variant 选择小尺寸稿或标准稿
 * 输入 (Input / @param):
 *   - variant: 'compact' | 'display' - 'compact'（默认）用于 24px 以下，'display' 用于 32px 及以上
 * 输出 (Output): 渲染对应的 SVG 图标；颜色跟随 currentColor，默认品牌色见 styles/icons.css
 * 副作用 (Side-effects): 无
 */
withDefaults(defineProps<{
  variant?: 'compact' | 'display';
}>(), {
  variant: 'compact',
});
</script>
