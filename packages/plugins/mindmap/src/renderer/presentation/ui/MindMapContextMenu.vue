<template>
  <Teleport v-if="visible" to="body">
    <div ref="menuRef" class="mindmap-context-menu-panel" :style="menuStyle" @mousedown.stop>
      <CustomSelect
        :options="menuItems"
        :manual-mode="true"
        :is-open="visible"
        variant="minimal"
        min-width="160px"
        @update:model-value="handleMenuSelect"
        @close="handleClose"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { CustomSelect } from '@linnya/renderer-ui'
import type { ArrowOptions } from '../render/arrow'
import type { Topic } from '../../domain/types/dom'
import { useMindMapStore } from '../../domain/store/mindmapStore'
import { buildMindMapContextMenuItems } from './contextMenu/menuItems'
import type { MenuAction, MenuItem } from './contextMenu/types'

type OpenContextMenuPayload = {
  nodeId?: string
  x: number
  y: number
  trigger: 'mouse' | 'keyboard'
}

const store = useMindMapStore()
const mind = computed(() => store.mind)
const visible = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const menuPosition = reactive({ x: 0, y: 0 })
const isRootNode = ref(true)
const currentTarget = ref<Topic | null>(null)

const menuItems = computed<MenuItem[]>(() =>
  buildMindMapContextMenuItems({ isRootNode: isRootNode.value }),
)

const menuStyle = computed(() => ({
  position: 'fixed' as const,
  left: `${menuPosition.x}px`,
  top: `${menuPosition.y}px`,
  zIndex: 10000,
}))

const handleClose = () => {
  visible.value = false
}

onClickOutside(menuRef, handleClose)

const clampMenuPanelToViewport = async () => {
  await nextTick()
  requestAnimationFrame(() => {
    const element = menuRef.value
    if (!element) return
    const rect = element.getBoundingClientRect()
    const padding = 8
    menuPosition.x = Math.min(Math.max(menuPosition.x, padding), Math.max(padding, window.innerWidth - rect.width - padding))
    menuPosition.y = Math.min(Math.max(menuPosition.y, padding), Math.max(padding, window.innerHeight - rect.height - padding))
  })
}

const handleCreateLink = (options?: ArrowOptions) => {
  const instance = mind.value
  const from = instance?.currentNode
  if (!instance || !from) return

  const tips = document.createElement('div')
  tips.className = 'mindmap-link-tips'
  tips.innerText = '点击目标节点完成连接'
  document.body.appendChild(tips)

  const handleLinkClick = (event: MouseEvent) => {
    event.preventDefault()
    tips.remove()
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const topicElement = target.tagName === 'MM-TOPIC' ? target : target.closest('mm-topic')
    if (!(topicElement instanceof HTMLElement)) return
    const parentTag = topicElement.parentElement?.tagName
    if (parentTag === 'MM-NODE' || parentTag === 'MM-ROOT') {
      instance.createArrow(from, topicElement as unknown as Topic, options)
    }
  }

  instance.map.addEventListener('click', handleLinkClick, { once: true })
}

const handleMenuSelect = (value: MenuAction | null) => {
  const instance = mind.value
  if (!instance || !value) {
    handleClose()
    return
  }

  const target = currentTarget.value
  if (target && instance.currentNodes.length === 0) instance.selectNode(target)
  const nodeId = target?.nodeObj?.id ?? instance.currentNode?.nodeObj?.id

  switch (value) {
    case 'add_child':
      if (nodeId) instance.commands.node.addChild({ nodeId }, { source: 'contextMenu' })
      break
    case 'remove_node':
      if (!isRootNode.value) instance.commands.node.removeSelected({}, { source: 'contextMenu' })
      break
    case 'focus':
      if (!isRootNode.value && instance.currentNode) instance.focusNode(instance.currentNode)
      break
    case 'unfocus':
      instance.cancelFocus()
      break
    case 'move_up':
      if (!isRootNode.value) instance.moveUpNode()
      break
    case 'move_down':
      if (!isRootNode.value) instance.moveDownNode()
      break
    case 'summary':
      instance.createSummary()
      instance.unselectNodes(instance.currentNodes)
      break
    case 'link':
      handleCreateLink()
      break
    case 'link_bidirectional':
      handleCreateLink({ bidirectional: true })
      break
  }
  handleClose()
}

const handleOpenContextMenu = (payload: OpenContextMenuPayload) => {
  const instance = mind.value
  if (!instance || !payload.nodeId) {
    handleClose()
    return
  }

  let topic: Topic
  try {
    topic = instance.findEle(payload.nodeId) as unknown as Topic
  } catch {
    handleClose()
    return
  }

  currentTarget.value = topic
  isRootNode.value = topic.parentElement?.tagName === 'MM-ROOT'
  menuPosition.x = payload.x
  menuPosition.y = payload.y
  visible.value = true
  void clampMenuPanelToViewport()
}

const busContextMenuHandler = (payload: OpenContextMenuPayload) => handleOpenContextMenu(payload)

const detachHandlers = () => {
  mind.value?.bus?.removeListener('ui:openContextMenu', busContextMenuHandler)
}

const attachHandlers = () => {
  mind.value?.bus?.addListener('ui:openContextMenu', busContextMenuHandler)
}

onMounted(attachHandlers)
watch(() => mind.value, (newInstance, oldInstance) => {
  oldInstance?.bus?.removeListener('ui:openContextMenu', busContextMenuHandler)
  newInstance?.bus?.addListener('ui:openContextMenu', busContextMenuHandler)
})
onBeforeUnmount(() => {
  detachHandlers()
  handleClose()
})
</script>
