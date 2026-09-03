<template>
  <template v-for="item in renderItems" :key="item.key">
    <Teleport :to="item.targetEl">
      <component :is="item.component" :mind="mind" :node-id="item.nodeId" />
    </Teleport>
  </template>
</template>

<script setup lang="ts">
/**
 * NodeAddonsHost.vue
 *
 * 中文说明：
 * - 统一承载“节点 addons”的渲染（白板方向的核心基础设施）
 * - feature 不再自己 v-for + Teleport + 查 DOM，而是注册 addon 组件到 registry
 * - Host 负责：
 *   - 遍历当前 DOM 中可见节点的 `.mm-topic-addons[data-nodeid]`
 *   - 依次决定每个 addon 是否渲染，并 Teleport 到对应节点
 *
 * 约束：
 * - addon 组件必须接受 props：{ mind: MindMapInstance, nodeId: string }
 * - addon 组件内部所有“尺寸变化”必须走 mind.requestReflow('addons:toggle'|'addons:content')
 */

import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { MindMapInstance } from '../../domain/types'
import { getNodeAddonsRegistry } from '../addons/nodeAddonsRegistry'
import { fromDomNodeId } from '../../shared/utils/dom/nodeId'

interface Props {
  mind: MindMapInstance
}

const props = defineProps<Props>()
const mind = computed(() => props.mind)

const registry = computed(() => getNodeAddonsRegistry(props.mind))

/**
 * 触发一次 addons 重算
 *
 * 中文说明（根因修复）：
 * - 重新打开文档时，addons（引用预览/其它扩展）会在 Teleport 后改变节点高度
 * - 如果此时没有触发 `requestReflow`，连线仍按旧几何计算，表现为“线条错位”
 * - 展开/收起之所以能恢复，是因为展开路径里显式调用了 requestReflow
 * - 这里把“addons 渲染完成后的重算”收敛到 Host，避免每个 addon 组件重复写补丁
 */
async function requestAddonsReflow() {
  await nextTick()
  props.mind.requestReflow('addons:content')
}

const renderItems = computed(() => {
  const instance = mind.value
  const mapEl = instance?.map ?? null
  if (!mapEl) return []

  const registrations = registry.value.registrations.value
  if (!registrations || registrations.length === 0) return []

  // 中文说明：先让每个注册项声明其响应式依赖，确保后续渲染条件变化能触发重新计算
  for (const reg of registrations) {
    reg.track?.()
  }

  const addonEls = Array.from(mapEl.querySelectorAll('.mm-topic-addons[data-nodeid]')) as HTMLElement[]

  // 中文说明：使用 WeakMap 为每个 DOM 元素分配唯一 ID，确保当 MindMap 引擎重建 DOM 节点时，
  // 即使 nodeId 没变，组件也会因为 key 变化而重建，从而重新绑定 ResizeObserver。
  const elUidMap = getElUidMap()

  const items: Array<{
    key: string
    nodeId: string
    targetEl: HTMLElement
    component: unknown
  }> = []

  for (const el of addonEls) {
    const domId = el.dataset.nodeid
    if (!domId) continue
    // 中文说明：DOM 属性统一使用 domId（me 前缀），这里第一时间转换为业务 nodeId
    const nodeId = fromDomNodeId(domId)
    if (!nodeId) continue

    for (const reg of registrations) {
      if (!reg.shouldRender({ mind: instance, nodeId })) continue
      items.push({
        // 中文说明（根因修复）：
        // 加入 elUid 确保 key 与 DOM 实例绑定。
        // 场景：右侧历史对话加载引用 -> 触发 Store 更新 -> MindMap 刷新 DOM -> NodeAddonsHost 重算。
        // 若不加 elUid，Vue 会复用组件并 Teleport 到新 DOM，但组件内的 ResizeObserver 仍监听旧 DOM（已 Detached），
        // 导致宽度计算失效（0）-> 样式回退 -> 溢出。
        key: `${reg.id}:${nodeId}:${getElUid(elUidMap, el)}`,
        nodeId,
        targetEl: el,
        component: reg.component,
      })
    }
  }

  return items
})

// --- Helpers ---

const _elUidMap = new WeakMap<HTMLElement, number>()
let _uidCounter = 0

function getElUidMap() {
  return _elUidMap
}

function getElUid(map: WeakMap<HTMLElement, number>, el: HTMLElement) {
  let uid = map.get(el)
  if (uid === undefined) {
    uid = ++_uidCounter
    map.set(el, uid)
  }
  return uid
}

// 初次挂载 + 每次 renderItems 变更，都触发一次重算（由 ReflowScheduler 合并同帧请求）
const lastKeySig = ref('')
onMounted(() => {
  void requestAddonsReflow()
})

watch(
  () => renderItems.value.map(i => i.key).join('|'),
  async (sig) => {
    if (sig === lastKeySig.value) return
    lastKeySig.value = sig
    await requestAddonsReflow()
  },
  { flush: 'post' }
)
</script>

