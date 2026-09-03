<!--
  @file MarkstreamRenderer.vue
  @description 会话消息 Markdown 渲染器（解析器内嵌 + 自研渲染层）

  背景：
  - 我们已经把 markstream 的核心解析器拷进 `packages/stream-markdown-parser`
  - 由于会话消息的样式/组件高度自定义，直接使用 markstream-vue 的整套渲染层会带来大量样式重写成本

  当前策略：
  - **只复用解析器**：Markdown -> AST（ParsedNode[]）
  - **渲染层由我们掌控**：默认用原生 HTML 标签输出，只有 code/latex/reference 等必须自定义的节点才用组件
-->
<template>
  <div class="markstream-message-renderer" data-scope="conversation-message">
    <ConversationMarkdownRenderer
      :content="content"
      :isStreaming="isStreaming"
      :turnId="turnId"
      :citation-dependencies="citationDependencies"
    />
  </div>
</template>

<script setup lang="ts">
import { toRefs } from 'vue'
import ConversationMarkdownRenderer from './stream/ConversationMarkdownRenderer'
import type { ConversationCitationDependencySnapshot } from '@app/schemas'

interface Props {
  /** 原始 Markdown 文本（可以是流式拼接后的全量字符串） */
  content: string
  /** 是否处于流式输出中（会影响渲染策略：打字机/批次渲染） */
  isStreaming?: boolean
  /** 对话轮次 ID（供引用 transfer DOM 标注归属） */
  turnId?: string
  citationDependencies?: ConversationCitationDependencySnapshot
}

const props = withDefaults(defineProps<Props>(), {
  isStreaming: false,
  turnId: undefined,
  citationDependencies: undefined,
})

// 这里必须保持响应式：消息内容是流式更新的
const { content, isStreaming, turnId, citationDependencies } = toRefs(props)
</script>
