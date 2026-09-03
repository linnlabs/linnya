<!--
  @file ConversationCodeBlockNode.vue
  @description markstream-vue 的 code_block 节点 → 我们的 SmartCodeBlock 适配器
  
  目标：
  - 保留我们现有的代码块体验（复制按钮、语法高亮、流式光标）
  - 在切换到 markstream-vue 时，不丢失自研 UI
-->
<template>
  <SmartCodeBlock
    :code="code"
    :language="language"
    :isStreaming="isStreaming"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SmartCodeBlock from '../SmartCodeBlock.vue'
import type { CodeBlockNode } from 'stream-markdown-parser'

const props = defineProps<{
  node: CodeBlockNode
  /**
   * markstream-vue 在渲染时会透传 `stream`（表示代码块是否需要流式更新）。
   * 这里我们用它控制 SmartCodeBlock 的光标显示。
   */
  stream?: boolean
  /** 部分节点在 mid-state 会带 loading 标记（这里保留字段，便于后续扩展） */
  loading?: boolean
}>()

const code = computed(() => props.node.code ?? '')
const language = computed(() => props.node.language ?? 'plaintext')
const isStreaming = computed(() => Boolean(props.stream) || Boolean(props.loading) || Boolean(props.node.loading))
</script>


