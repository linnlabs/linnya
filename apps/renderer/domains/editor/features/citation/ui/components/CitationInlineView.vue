<template>
  <node-view-wrapper
    as="span"
    class="citation-mark"
    data-type="citation"
    v-bind="portableAttributes"
    contenteditable="false"
    >{{ label }}</node-view-wrapper
  >
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { getCitationDerivation } from '../../render/citationRenderPlugin'
import { readCitationNodeAttrs } from '../../functions/citationNodeProjection'

const props = defineProps(nodeViewProps)
const label = ref('[?]')

function optionalJsonAttribute(items: string[] | undefined): string | undefined {
  return items && items.length > 0 ? JSON.stringify(items) : undefined
}

/**
 * NodeView 是当前可见 DOM，但复制/粘贴仍需要完整来源快照。这里与 CitationNode.renderHTML
 * 投影同一组字段，避免浏览器复制 NodeView 时只留下编号和部分身份。
 */
const portableAttributes = computed(() => {
  const attrs = readCitationNodeAttrs(props.node.attrs)
  if (!attrs) return {}
  return {
    'data-citation-id': attrs.citationId,
    'data-citation-ref': attrs.ref,
    'data-source-type': attrs.sourceType,
    'data-source-id': attrs.sourceId,
    'data-kb-id': attrs.kbId,
    'data-block-id': attrs.blockId,
    'data-title': attrs.title,
    'data-snippet': attrs.snippet,
    'data-snippets': optionalJsonAttribute(attrs.snippets),
    'data-authors': optionalJsonAttribute(attrs.authors),
    'data-date': attrs.date,
    'data-url': attrs.url,
    'data-container-title': attrs.containerTitle,
  }
})

function syncFromState(): void {
  const attrs = readCitationNodeAttrs(props.node.attrs)
  label.value =
    (attrs
      ? getCitationDerivation(props.editor.state)?.labelByCitationId.get(attrs.citationId)
      : undefined) ?? '[?]'
}

onMounted(() => {
  syncFromState()
  props.editor.on('transaction', syncFromState)
})

onBeforeUnmount(() => {
  props.editor.off('transaction', syncFromState)
})

watch(() => props.node.attrs, syncFromState)
</script>
