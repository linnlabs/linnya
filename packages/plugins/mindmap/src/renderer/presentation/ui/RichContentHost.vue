<template>
  <Teleport
    v-for="entry in entries"
    :key="entry.node.id"
    :to="entry.host"
  >
    <RichContentRenderer :descriptor="entry.descriptor" />
  </Teleport>
</template>

<script setup lang="ts">
import { shallowRef, watch, onBeforeUnmount, defineComponent, h, computed, type PropType } from 'vue'
import type { MindMapInstance, NodeObj, RichContentDescriptor } from '../../domain/types/index'
import type { EventMap } from '../../shared/utils/events/eventBus'
import katex from 'katex'

type Entry = {
  node: NodeObj
  host: HTMLElement
  descriptor: RichContentDescriptor
}

const props = defineProps<{
  mind: MindMapInstance
}>()

const entries = shallowRef<Entry[]>([])
const observers = new Map<string, ResizeObserver>()

const detachObserver = (nodeId: string) => {
  const observer = observers.get(nodeId)
  if (observer) {
    observer.disconnect()
    observers.delete(nodeId)
  }
}

const removeEntry = (nodeId: string) => {
  const existing = entries.value.find(entry => entry.node.id === nodeId)
  if (existing) {
    detachObserver(nodeId)
    existing.host.innerHTML = ''
  }
  entries.value = entries.value.filter(entry => entry.node.id !== nodeId)
}

const handleMount: EventMap['richContentMount'] = (payload) => {
  removeEntry(payload.node.id)
  const host = payload.host
  host.dataset.richContentMounted = 'true'
  host.innerHTML = ''
  entries.value = [...entries.value, payload]
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      // 使用 ReflowScheduler 统一调度重算，避免散落调用导致的抖动/卡顿
      props.mind.requestReflow('rich-content:resize')
    })
    observer.observe(host)
    observers.set(payload.node.id, observer)
  }
}

const handleUnmount: EventMap['richContentUnmount'] = ({ nodeId }) => {
  removeEntry(nodeId)
}

const cleanup = () => {
  entries.value.forEach(entry => {
    detachObserver(entry.node.id)
    entry.host.innerHTML = ''
  })
  entries.value = []
}

watch(
  () => props.mind,
  (newMind, oldMind) => {
    if (oldMind?.bus) {
      oldMind.bus.removeListener('richContentMount', handleMount)
      oldMind.bus.removeListener('richContentUnmount', handleUnmount)
    }
    if (newMind?.bus) {
      newMind.bus.addListener('richContentMount', handleMount)
      newMind.bus.addListener('richContentUnmount', handleUnmount)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (props.mind?.bus) {
    props.mind.bus.removeListener('richContentMount', handleMount)
    props.mind.bus.removeListener('richContentUnmount', handleUnmount)
  }
  cleanup()
})

const KatexRenderer = defineComponent({
  name: 'KatexRenderer',
  props: {
    value: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const html = computed(() =>
      katex.renderToString(props.value, {
        throwOnError: false,
        output: 'html',
      })
    )
    return () =>
      h('div', {
        class: 'mindmap-rich-katex',
        innerHTML: html.value,
      })
  },
})

const CodeRenderer = defineComponent({
  name: 'CodeRenderer',
  props: {
    value: {
      type: String,
      required: true,
    },
    language: {
      type: String,
      default: '',
    },
  },
  setup(props) {
    return () =>
      h('pre', { class: 'mindmap-rich-code' }, [
        h(
          'code',
          {
            class: props.language ? `language-${props.language}` : undefined,
          },
          props.value
        ),
      ])
  },
})

const HtmlRenderer = defineComponent({
  name: 'HtmlRenderer',
  props: {
    value: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h('div', {
        class: 'mindmap-rich-html',
        innerHTML: props.value,
      })
  },
})

const RichContentRenderer = defineComponent({
  name: 'RichContentRenderer',
  props: {
    descriptor: {
      type: Object as PropType<RichContentDescriptor>,
      required: true,
    },
  },
  setup(props) {
    return () => {
      const descriptor = props.descriptor
      if (descriptor.type === 'katex') {
        return h(KatexRenderer, { value: descriptor.value })
      }
      if (descriptor.type === 'code') {
        return h(CodeRenderer, { value: descriptor.value, language: descriptor.language })
      }
      if (descriptor.type === 'html') {
        return h(HtmlRenderer, { value: descriptor.value })
      }
      return null
    }
  },
})
</script>
{
  "cells": [],
  "metadata": {
    "language_info": {
      "name": "python"
    }
  },
  "nbformat": 4,
  "nbformat_minor": 2
}
