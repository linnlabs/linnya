<!--
 * @file apps/renderer/features/LatexBlock/ui/KatexRenderer.vue
 * @description 一个简单的 Vue 组件，用于接收 LaTeX 字符串并使用 KaTeX 将其渲染为 HTML。
 *
 * 功能 (What):
 * - 接收一个 `latex` prop (字符串)。
 * - 使用 `katex.renderToString` 将该字符串转换为 HTML。
 * - 通过 `v-html` 指令将渲染后的 HTML 显示在一个 `<span>` 元素中。
 * - 在组件挂载和 `latex` prop 变化时自动重新渲染。
 * - 渲染时使用 `displayMode: false` 以确保公式以内联形式显示，适合在按钮等紧凑空间中使用。
 *
 * 输入 (Input / @param):
 * - `latex` (String, required): 需要渲染的 LaTeX 字符串。
 *
 * 输出 (Output / @returns):
 * - 一个包含 KaTeX 渲染结果的 `<span>` 元素。
 *
 * 副作用 (Side-effects):
 * - 如果 KaTeX 渲染失败，会在控制台打印错误，并在界面上显示一个错误指示符。
-->
<template>
  <span v-html="renderedHtml"></span>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import katex from 'katex';

const props = defineProps({
  latex: {
    type: String,
    required: true,
  },
});

const renderedHtml = ref('');

const render = () => {
  try {
    renderedHtml.value = katex.renderToString(props.latex, {
      throwOnError: false,
      displayMode: false, // 确保以内联模式渲染，适合按钮
      output: 'html',
      strict: false,
    });
  } catch (error) {
    console.error('[KatexRenderer] KaTeX rendering error:', error);
    // 在按钮内提供一个清晰的错误指示
    renderedHtml.value = '<span class="katex-render-error">!</span>';
  }
};

// --- Lifecycle ---
onMounted(render);
watch(() => props.latex, render);

</script>
