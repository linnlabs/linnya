<!--
  RippleLoadingIcon.vue
  
  通用加载中动画图标组件
  
  功能：提供涟漪扩散效果的加载动画，适用于各种加载场景
  特点：
  - 两个同心圆交替扩散，营造波纹效果
  - 可自定义颜色
  - 默认尺寸 18x18，适合内联显示
  
  Props:
  - color: 图标颜色，默认为主题强调色
  
  使用场景：
  - 数据加载中
  - 处理中状态
  - 等待反馈
-->
<template>
  <svg width="18" height="18" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" :stroke="color">
    <g fill="none" fill-rule="evenodd" stroke-width="2.5">
      <circle cx="22" cy="22" r="1">
        <animate attributeName="r"
          begin="0s" dur="2.5s"
          values="1; 20"
          calcMode="spline"
          keyTimes="0; 1"
          keySplines="0.165, 0.84, 0.44, 1"
          repeatCount="indefinite" />
        <animate attributeName="stroke-opacity"
          begin="0s" dur="2.5s"
          values="1; 0"
          calcMode="spline"
          keyTimes="0; 1"
          keySplines="0.3, 0.61, 0.355, 1"
          repeatCount="indefinite" />
      </circle>
      <circle cx="22" cy="22" r="1">
        <animate attributeName="r"
          begin="-1.25s" dur="2.5s"
          values="1; 20"
          calcMode="spline"
          keyTimes="0; 1"
          keySplines="0.165, 0.84, 0.44, 1"
          repeatCount="indefinite" />
        <animate attributeName="stroke-opacity"
          begin="-1.25s" dur="2.5s"
          values="1; 0"
          calcMode="spline"
          keyTimes="0; 1"
          keySplines="0.3, 0.61, 0.355, 1"
          repeatCount="indefinite" />
      </circle>
    </g>
  </svg>
</template>

<script setup lang="ts">
defineProps({
  color: {
    type: String,
    default: 'var(--color-accent-hover)'
  }
});
</script>
