<template>
  <!-- 渲染入口统一经过 projectSkillPreview 的 DOMPurify；原始 HTML 不进入此组件。 -->
  <!-- eslint-disable vue/no-v-html -->
  <div
    v-if="'html' in preview"
    class="skills-markdown-preview"
    v-html="preview.html"
  />
  <pre
    v-else
    class="skills-source-preview"
  >{{ preview.text }}</pre>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { projectSkillPreview } from '../functions/projectSkillPreview';

const props = defineProps<{ path: string; content: string }>();
const preview = computed(() => projectSkillPreview(props.path, props.content));
</script>
