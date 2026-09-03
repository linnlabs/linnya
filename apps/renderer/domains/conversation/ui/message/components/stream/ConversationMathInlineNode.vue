<!--
  @file ConversationMathInlineNode.vue
  @description 会话侧行内公式渲染节点
-->
<template>
  <span ref="el" class="md-math-inline-node" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderToString as katexRenderToString } from 'katex'
import type { MathInlineNode } from 'stream-markdown-parser'

const props = withDefaults(defineProps<{
  node: MathInlineNode
  isStreaming?: boolean
}>(), {
  isStreaming: false,
})

const el = ref<HTMLElement | null>(null)
let hasRenderedOnce = false
let currentRenderId = 0
let isUnmounted = false

function renderMath() {
  if (isUnmounted || !el.value) return

  const renderId = ++currentRenderId
  const content = String(props.node.content ?? '')
  const isLoading = Boolean(props.isStreaming) && Boolean(props.node.loading)

  try {
    const html = katexRenderToString(content, {
      displayMode: false,
      // 中间态直接 throw，避免输出 katex-error DOM 导致闪烁
      throwOnError: isLoading,
      strict: 'ignore',
    })
    if (isUnmounted || renderId !== currentRenderId || !el.value) return
    el.value.innerHTML = html
    hasRenderedOnce = true
  }
  catch (_e) {
    if (isUnmounted || renderId !== currentRenderId || !el.value) return
    // 无论是否 loading，只要曾经成功渲染过，就不要“打回原形”
    if (hasRenderedOnce) return
    // 从未成功渲染过：展示 raw 便于定位
    el.value.textContent = String(props.node.raw ?? '')
  }
}

watch(() => props.node.content, renderMath, { immediate: true })
watch(() => props.node.loading, renderMath)
watch(() => props.isStreaming, renderMath)

onMounted(() => {
  // watch(immediate) 时 DOM ref 可能还未绑定，重放场景不会再变化，因此 mounted 后强制渲染一次
  renderMath()
})

onBeforeUnmount(() => {
  isUnmounted = true
  currentRenderId++
})
</script>
