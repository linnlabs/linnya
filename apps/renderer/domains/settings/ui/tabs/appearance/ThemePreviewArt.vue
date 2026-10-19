<!-- apps/renderer/domains/settings/ui/tabs/appearance/ThemePreviewArt.vue -->
<!--
  主题预览插画：96 × 60 的简洁抽象场景，只靠色块与少量形状表达“白天（白底加一轮太阳）/ 月白 / 夜晚”。
  颜色来自 theme-preview.css 里的固定调色板（插画描述的是主题本身，不随当前主题变化）。
-->
<template>
  <svg class="theme-preview-art" viewBox="0 0 96 60" preserveAspectRatio="xMidYMid slice" focusable="false">
    <template v-if="scene === 'day'">
      <rect class="pv-day-sky" width="96" height="60" />
      <circle class="pv-sun-halo" cx="72" cy="17" r="11" />
      <circle class="pv-sun" cx="72" cy="17" r="6.5" />
    </template>
    <template v-else-if="scene === 'moon'">
      <rect class="pv-moon-sky" width="96" height="60" />
      <path class="pv-moon-white" transform="translate(70 20)" :d="CRESCENT_PATH" />
      <path class="pv-star pv-star--moon" transform="translate(26 20) scale(1.15)" :d="STAR_PATH" />
      <path class="pv-star pv-star--moon" transform="translate(44 38) scale(0.8)" :d="STAR_PATH" />
      <g class="pv-cloud pv-cloud--moon" transform="translate(14 36) scale(0.95)">
        <rect x="0" y="9" width="30" height="9" rx="4.5" />
        <circle cx="10" cy="9" r="6.2" />
        <circle cx="19.5" cy="7" r="8" />
      </g>
    </template>
    <template v-else>
      <rect class="pv-night-sky" width="96" height="60" />
      <path class="pv-moon-warm" transform="translate(68 21)" :d="CRESCENT_PATH" />
      <path class="pv-star pv-star--1" transform="translate(24 18) scale(1.2)" :d="STAR_PATH" />
      <path class="pv-star pv-star--2" transform="translate(42 36) scale(0.8)" :d="STAR_PATH" />
      <path class="pv-star pv-star--2" transform="translate(84 44) scale(0.7)" :d="STAR_PATH" />
      <path class="pv-star pv-star--3" transform="translate(50 12) scale(0.6)" :d="STAR_PATH" />
    </template>
  </svg>
</template>

<script setup lang="ts">
import type { ThemePreviewScene } from '../../../definitions/themePreview';

defineProps<{
  readonly scene: ThemePreviewScene;
}>();

/** 以原点为圆心的月牙：外圆 R=9，被偏移的内圆切掉一侧，交点按几何精确计算。 */
const CRESCENT_PATH = 'M 6.37 6.36 A 9 9 0 1 0 0.8 -8.96 A 8.28 8.28 0 1 1 6.37 6.36 Z';
/** 四角星：四条内凹曲线围成。 */
const STAR_PATH = 'M0 -3 C0.35 -0.9 0.9 -0.35 3 0 C0.9 0.35 0.35 0.9 0 3 C-0.35 0.9 -0.9 0.35 -3 0 C-0.9 -0.35 -0.35 -0.9 0 -3Z';
</script>
