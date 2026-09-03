<template>
  <!-- 移除 Teleport 里的 overlay，直接使用 Teleport 挂载 panel -->
  <Teleport
    v-if="visible"
    to="body"
    >
      <div
        class="mindmap-context-menu-panel"
        :style="menuStyle"
      @mousedown.stop
      ref="menuRef"
      >
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
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import type { ArrowOptions } from '../render/arrow';
import type { Topic } from '../../domain/types/dom';
import { useMindMapStore } from '../../domain/store/mindmapStore';
import { onClickOutside } from '@vueuse/core';
import { useMindMapEvidenceStore } from '../../features/evidence/domain/store/evidenceStore';
import { startMindMapAiRun } from './contextMenu/mindmapAiRun'
import type { MenuAction, MenuItem } from './contextMenu/types'
import { buildMindMapContextMenuItems } from './contextMenu/menuItems'
import {
  NODE_KIND,
  TAGGING_STATUS,
  TAGGING_CONFIDENCE_LEVEL,
  type NodeKind,
  type TaggingConfidenceValue,
  type TaggingStatusValue,
  canSetConfidenceForKind,
  canSetStatusForKind,
  isValidConfidenceValue,
  isValidStatusValue,
  parseNodeKind,
} from '../../domain/tagging/taggingRules';

const store = useMindMapStore();
const mind = computed(() => store.mind);
const evidenceStore = useMindMapEvidenceStore();

// 菜单状态
const visible = ref(false);
const menuRef = ref<HTMLElement | null>(null);
const menuPosition = reactive<{ x: number; y: number }>({ x: 0, y: 0 });
const isRootNode = ref(true);
const currentTarget = ref<Topic | null>(null);
/** 当前节点的语义类型（用于菜单勾选状态） */
const currentNodeKind = ref<NodeKind | null>(null);
/** 当前节点的状态（用于菜单勾选状态） */
const currentNodeStatus = ref<TaggingStatusValue | null>(null);
/** 当前节点的置信度（用于菜单勾选状态） */
const currentNodeConfidence = ref<TaggingConfidenceValue | null>(null);

/**
 * 将右键菜单面板的位置收敛到视口内
 *
 * 中文说明（根因）：
 * - 右键菜单的初始坐标来自 `MouseEvent.clientX/clientY`，但如果用户在窗口边缘右键，菜单面板本体可能会“部分跑出视口”。
 * - `CustomSelect` 的子菜单定位为了保证可见，会对 `left/top` 做视口 clamp。
 * - 当主菜单已经越界时，子菜单被 clamp 回视口内，就会出现“子菜单离父菜单很远”的观感（两者不再贴边）。
 * - 解决办法：主菜单打开后，基于实际渲染尺寸把主菜单先 clamp 回视口内，保证主/子菜单在同一坐标系下都能贴边。
 */
const clampMenuPanelToViewport = async () => {
  await nextTick();

  // 用 rAF 确保浏览器完成一次布局计算（rect/width/height 才稳定）
  requestAnimationFrame(() => {
    const el = menuRef.value;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 8;

    // 最大 left/top：保证面板右/下边缘不越界（面板比视口更大时，至少贴到 padding）
    const maxX = Math.max(padding, viewportWidth - rect.width - padding);
    const maxY = Math.max(padding, viewportHeight - rect.height - padding);

    const clampedX = Math.min(Math.max(menuPosition.x, padding), maxX);
    const clampedY = Math.min(Math.max(menuPosition.y, padding), maxY);

    if (clampedX !== menuPosition.x) {
      menuPosition.x = clampedX;
    }
    if (clampedY !== menuPosition.y) {
      menuPosition.y = clampedY;
    }
  });
};

// 点击外部关闭菜单
onClickOutside(menuRef, () => {
  handleClose();
});

// 计算菜单样式（定位）
const menuStyle = computed(() => ({
  position: 'fixed' as const,
  left: `${menuPosition.x}px`,
  top: `${menuPosition.y}px`,
  zIndex: 10000,
}));

// 构建菜单项
const menuItems = computed<MenuItem[]>(() => {
  /**
   * 当前节点的引用计数是否“已知”
   *
   * 中文说明：
   * - 引用 feature 会在初始化时批量加载所有节点的 count，正常情况下这里应该是“已知”
   * - 但右键菜单不再提供“展开引用”，只保留“添加引用”
   * - 为了保证“有引用时禁用添加引用”的口径稳定，这里把 count 未就绪视为“不可操作”（先禁用）
   */
  const targetNodeId = currentTarget.value?.nodeObj?.id || '';
  const counts = evidenceStore.evidenceCounts;
  /**
   * 必须直接读取 `counts[targetNodeId]` 来建立响应式依赖。
   *
   * 根因说明：
   * - 使用 `hasOwnProperty` 判断“是否存在 key”时，Vue3 的依赖追踪在某些场景下不会对后续的 key 写入触发更新，
   *   会导致菜单项一直停留在首次计算结果（表现为“添加引用”禁用状态不更新）。
   * - 直接读取属性会稳定建立依赖：即使当前是 undefined，后续写入 0 也会触发菜单重新计算。
   */
  const status = targetNodeId ? evidenceStore.getCountStatus(targetNodeId) : 'unknown'
  const targetEvidenceCount = targetNodeId ? counts[targetNodeId] : undefined
  const hasEvidence = status === 'loaded' && (targetEvidenceCount ?? 0) > 0
  /**
   * 只保留“添加引用”入口。
   *
   * 禁用规则（需求口径）：
   * - count > 0：禁用（已有引用，不允许再次添加）
   * - count 未就绪（unknown/loading/error）：禁用（避免竞态时误开放）
   */
  const addEvidenceDisabled = !targetNodeId || status !== 'loaded' || hasEvidence

  return buildMindMapContextMenuItems({
    currentNodeKind: currentNodeKind.value,
    currentNodeStatus: currentNodeStatus.value,
    currentNodeConfidence: currentNodeConfidence.value,
    addEvidenceDisabled,
    isRootNode: isRootNode.value,
  })
});

// 处理菜单项选择
const handleMenuSelect = (value: MenuAction | null) => {
  if (!value) {
    handleClose();
    return;
  }

  if (!mind.value) return;

  const instance = mind.value;

  // 确保有选中节点，防止点击菜单时焦点丢失导致 selection 被清除
  const target = currentTarget.value;
  if (target && (!instance.currentNodes || instance.currentNodes.length === 0)) {
    instance.selectNode(target);
  }

  // 如果没有目标节点，说明是点击了背景，直接返回（菜单会自动关闭）
  // 但是为了防止意外选中之前的 target，这里可以显式处理
  if (!value && !target) {
    handleClose();
    return;
  }

  switch (value) {
    case 'add_child': {
      // 中文说明：通过命令系统添加子节点，source='contextMenu'
      const nodeId = target?.nodeObj?.id || instance.currentNode?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.addChild({ nodeId }, { source: 'contextMenu' })
      }
      break;
    }
    case 'add_evidence':
      // 通过事件总线触发：打开“插入引用”面板（同款 CitationPanel UX）
      if (target) {
        instance.bus.fire('ui:openReferenceInsertPanel', {
          nodeId: target.nodeObj.id,
          nodeTopic: target.nodeObj.topic,
        });
      }
      break;
    // =====================================================================
    // AI 入口只分发运行意图，具体历史隔离和 conversation 协作由 host port 负责。
    // =====================================================================
    case 'deep_analysis': {
      const nodeId = target?.nodeObj?.id
      const nodeTopic = target?.nodeObj?.topic
      if (nodeId && typeof nodeTopic === 'string') {
        void startMindMapAiRun({ action: 'deep_analysis', nodeId, nodeTopic })
      }
      break
    }
    case 'decompose_question': {
      const nodeId = target?.nodeObj?.id
      const nodeTopic = target?.nodeObj?.topic
      if (nodeId && typeof nodeTopic === 'string') {
        void startMindMapAiRun({ action: 'decompose_question', nodeId, nodeTopic })
      }
      break
    }
    case 'validate_hypothesis': {
      const nodeId = target?.nodeObj?.id
      const nodeTopic = target?.nodeObj?.topic
      if (nodeId && typeof nodeTopic === 'string') {
        void startMindMapAiRun({ action: 'validate_hypothesis', nodeId, nodeTopic })
      }
      break
    }
    case 'propose_hypothesis': {
      const nodeId = target?.nodeObj?.id
      const nodeTopic = target?.nodeObj?.topic
      if (nodeId && typeof nodeTopic === 'string') {
        void startMindMapAiRun({ action: 'propose_hypothesis', nodeId, nodeTopic })
      }
      break
    }
    case 'remove_node':
      // 中文说明：通过命令系统删除节点，source='contextMenu'
      // root 节点在菜单层已禁用，这里做二次保护
      if (!isRootNode.value) {
        instance.commands.node.removeSelected({}, { source: 'contextMenu' })
      }
      break;
    case 'focus':
      if (!isRootNode.value && instance.currentNode) {
        instance.focusNode(instance.currentNode);
      }
      break;
    case 'unfocus':
      instance.cancelFocus();
      break;
    case 'move_up':
      if (!isRootNode.value) instance.moveUpNode();
      break;
    case 'move_down':
      if (!isRootNode.value) instance.moveDownNode();
      break;
    case 'summary':
      instance.createSummary();
      instance.unselectNodes(instance.currentNodes);
      break;
    case 'link':
      handleCreateLink();
      break;
    case 'link_bidirectional':
      handleCreateLink({ bidirectional: true });
      break;
    // =====================================================================
    // 节点类型打标
    // =====================================================================
    case 'set_kind_hypothesis': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setKind({ nodeId, kind: 'hypothesis' }, { source: 'contextMenu' })
      }
      break;
    }
    case 'set_kind_question': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setKind({ nodeId, kind: 'question' }, { source: 'contextMenu' })
      }
      break;
    }
    case 'set_kind_conclusion': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setKind({ nodeId, kind: 'conclusion' }, { source: 'contextMenu' })
      }
      break;
    }
    case 'clear_kind': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setKind({ nodeId, kind: null }, { source: 'contextMenu' })
      }
      break;
    }
    // =====================================================================
    // 节点状态打标
    // =====================================================================
    case 'set_status_open': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setStatus({ nodeId, status: TAGGING_STATUS.OPEN }, { source: 'contextMenu' })
      }
      break
    }
    case 'set_status_verified': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setStatus({ nodeId, status: TAGGING_STATUS.VERIFIED }, { source: 'contextMenu' })
      }
      break
    }
    case 'set_status_refuted': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setStatus({ nodeId, status: TAGGING_STATUS.REFUTED }, { source: 'contextMenu' })
      }
      break
    }
    case 'set_status_closed': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setStatus({ nodeId, status: TAGGING_STATUS.CLOSED }, { source: 'contextMenu' })
      }
      break
    }
    case 'clear_status': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setStatus({ nodeId, status: null }, { source: 'contextMenu' })
      }
      break
    }
    // =====================================================================
    // 节点置信度打标
    // =====================================================================
    case 'set_confidence_high': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setConfidence({ nodeId, confidence: TAGGING_CONFIDENCE_LEVEL.HIGH }, { source: 'contextMenu' })
      }
      break
    }
    case 'set_confidence_medium': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setConfidence({ nodeId, confidence: TAGGING_CONFIDENCE_LEVEL.MEDIUM }, { source: 'contextMenu' })
      }
      break
    }
    case 'set_confidence_low': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setConfidence({ nodeId, confidence: TAGGING_CONFIDENCE_LEVEL.LOW }, { source: 'contextMenu' })
      }
      break
    }
    case 'clear_confidence': {
      const nodeId = target?.nodeObj?.id
      if (nodeId) {
        instance.commands.node.setConfidence({ nodeId, confidence: null }, { source: 'contextMenu' })
      }
      break
    }
  }

  handleClose();
};

// 处理创建连接（需要点击下一个目标节点）
const handleCreateLink = (options?: ArrowOptions) => {
  if (!mind.value || !mind.value.currentNode) return;

  const instance = mind.value;
  const from = instance.currentNode!;

  const tips = document.createElement('div');
  tips.className = 'mindmap-link-tips';
  tips.innerText = '点击目标节点完成连接';
  document.body.appendChild(tips);

  // 一次性监听下一次点击
  const handleLinkClick = (event: globalThis.MouseEvent) => {
    event.preventDefault();
    tips.remove();

    const topicElement = resolveTopicElement(event.target);
    if (!topicElement) return;

    const parentTag = topicElement.parentElement?.tagName;
    if (parentTag === 'MM-NODE' || parentTag === 'MM-ROOT') {
      instance.createArrow(from, topicElement as unknown as Topic, options);
    }
  };

  instance.map.addEventListener('click', handleLinkClick, { once: true });
};

type OpenContextMenuPayload = {
  nodeId?: string
  x: number
  y: number
  trigger: 'mouse' | 'keyboard'
}

// 处理右键菜单事件（纯 payload：不透传 MouseEvent/HTMLElement）
const handleOpenContextMenu = (payload: OpenContextMenuPayload) => {
  if (!mind.value) return;
  const instance = mind.value;

  const nodeId = payload.nodeId
  if (!nodeId) {
    // 中文说明：右键空白处（或键盘触发无节点）-> 关闭菜单
    visible.value = false;
    return;
  }

  let topicElement: Topic | null = null
  try {
    topicElement = instance.findEle(nodeId) as unknown as Topic
  } catch (err) {
    console.warn('[MindMapContextMenu] openContextMenu: topic not found', { nodeId, err })
    visible.value = false
    return
  }

  currentTarget.value = topicElement

  /**
   * 中文说明：
   * - 右键菜单的“添加引用是否禁用”依赖 count 是否已写入
   * - 如果出现竞态（例如：文档刚切换），这里会主动补一发 loadCounts([nodeId])，确保 UI 口径稳定
   */
  const countStatus = evidenceStore.getCountStatus(nodeId)
  if (countStatus === 'unknown' || countStatus === 'error') {
    void evidenceStore.loadCounts([nodeId])
  }

  // 调试信息：确认右键目标节点的引用计数是否已写入（无引用应为 0）
  try {
    const count = evidenceStore.evidenceCounts[nodeId]
    console.log('[MindMapContextMenu] evidence count snapshot', { nodeId, status: countStatus, count })
  } catch (err) {
    console.log('[MindMapContextMenu] evidence count snapshot failed', err)
  }

  // 判断是否为根节点
  const parentEl = topicElement.parentElement;
  isRootNode.value = parentEl?.tagName === 'MM-ROOT';

  // 读取当前节点的语义类型（用于菜单勾选状态）
  const nodeObj = topicElement.nodeObj;
  currentNodeKind.value = parseNodeKind(nodeObj?.tagging?.labels?.kind) ?? null;
  const rawStatus = nodeObj?.tagging?.status;
  currentNodeStatus.value = isValidStatusValue(rawStatus) ? rawStatus : null;
  const rawConfidence = nodeObj?.tagging?.confidence;
  currentNodeConfidence.value = isValidConfidenceValue(rawConfidence) ? rawConfidence : null;

  // 显示菜单
  menuPosition.x = payload.x;
  menuPosition.y = payload.y;
  visible.value = true;

  // 打开后立刻把面板位置收敛到视口内，避免边缘场景子菜单“跑很远”
  void clampMenuPanelToViewport();
};

// 处理关闭菜单
const handleClose = () => {
  visible.value = false;
};

const resolveTopicElement = (target: globalThis.EventTarget | null): globalThis.HTMLElement | null => {
  if (!(target instanceof globalThis.HTMLElement)) return null;
  if (target.tagName === 'MM-TOPIC') return target;
  return target.closest('mm-topic') as globalThis.HTMLElement | null;
};

const busContextMenuHandler = (payload: OpenContextMenuPayload) => {
  handleOpenContextMenu(payload);
};

const detachHandlers = () => {
  const instance = mind.value;
  if (instance?.bus) {
    instance.bus.removeListener('ui:openContextMenu', busContextMenuHandler);
  }
};

const attachHandlers = () => {
  const instance = mind.value;
  if (instance?.bus) {
    instance.bus.addListener('ui:openContextMenu', busContextMenuHandler);
  }
};

onMounted(() => {
  attachHandlers();
});

watch(
  () => mind.value,
  (newInstance, oldInstance) => {
    if (oldInstance?.bus) {
      oldInstance.bus.removeListener('ui:openContextMenu', busContextMenuHandler);
    }
    if (newInstance?.bus) {
      newInstance.bus.addListener('ui:openContextMenu', busContextMenuHandler);
    }
  }
);

onBeforeUnmount(() => {
  detachHandlers();
  handleClose();
});
</script>
