<!--
  @file ConversationMathBlockNode.vue
  @description 会话侧块级公式渲染节点（交互参考 TurnView 的复制按钮）
-->
<template>
  <div class="md-math-block-node" @mouseenter="handleMouseEnterContainer">
    <button
      class="md-math-copy-button"
      type="button"
      :title="conversationMessage('conversation.math.copySource')"
      :aria-label="conversationMessage('conversation.math.copySource')"
      @click.prevent.stop="handleCopy"
    >
      <!-- 对齐 TurnView：用 v-show 保持 DOM 稳定，避免内容切换引起 hover 边界抖动 -->
      <span v-show="showCopiedText" class="md-math-copied-text">
        {{ conversationMessage('conversation.math.copied') }}
      </span>
      <span v-show="!showCopiedText" class="md-math-copy-icon">
        <CopyIcon />
      </span>
    </button>
    <div class="md-math-scroll" ref="mathEl" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderToString as katexRenderToString } from 'katex'
import type { MathBlockNode } from 'stream-markdown-parser'
import { CopyIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../../useConversationLocalization'

const props = withDefaults(defineProps<{
  node: MathBlockNode
  isStreaming?: boolean
}>(), {
  isStreaming: false,
})

const mathEl = ref<HTMLElement | null>(null)
const { conversationMessage } = useConversationLocalization()

// 复制按钮状态（参考 TurnView.vue：点击后短暂显示“已复制”）
const showCopiedText = ref(false)
let copiedResetTimer: ReturnType<typeof setTimeout> | null = null

let hasRenderedOnce = false
let currentRenderId = 0
let isUnmounted = false

function renderMath() {
  if (isUnmounted || !mathEl.value) return

  const renderId = ++currentRenderId
  const content = String(props.node.content ?? '')
  const isLoading = Boolean(props.isStreaming) && Boolean(props.node.loading)

  try {
    const html = katexRenderToString(content, {
      displayMode: true,
      // 中间态直接 throw，避免输出 katex-error DOM 导致闪烁
      throwOnError: isLoading,
      strict: 'ignore',
    })
    if (isUnmounted || renderId !== currentRenderId || !mathEl.value) return
    mathEl.value.innerHTML = html
    hasRenderedOnce = true
  }
  catch (_e) {
    if (isUnmounted || renderId !== currentRenderId || !mathEl.value) return
    // 只要成功渲染过，就不要“打回原形”
    if (hasRenderedOnce) return
    mathEl.value.textContent = String(props.node.raw ?? '')
  }
}

watch(() => props.node.content, renderMath, { immediate: true })
watch(() => props.node.loading, renderMath)
watch(() => props.isStreaming, renderMath)

onMounted(() => {
  // watch(immediate) 触发时 DOM ref 可能未绑定，重放场景不会再变化，因此 mounted 后强制渲染一次
  renderMath()
})

function handleMouseEnterContainer() {
  // 与 TurnView 一致：鼠标进入容器时恢复图标（避免停留在“已复制”）
  showCopiedText.value = false
}

async function handleCopy() {
  const text = String(props.node.raw ?? props.node.content ?? '')
  if (!text) return

  try {
    await navigator.clipboard.writeText(text)
    showCopiedText.value = true
    if (copiedResetTimer) clearTimeout(copiedResetTimer)
    copiedResetTimer = setTimeout(() => {
      showCopiedText.value = false
      copiedResetTimer = null
    }, 2000)
  }
  catch {
    showCopiedText.value = false
  }
}

onBeforeUnmount(() => {
  isUnmounted = true
  currentRenderId++
  if (copiedResetTimer) {
    clearTimeout(copiedResetTimer)
    copiedResetTimer = null
  }
})
</script>
