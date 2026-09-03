<template>
  <div
    v-show="visible"
    class="node-editor-mask"
  >
    <!-- 实际编辑器 -->
    <div
      ref="editorContainer"
      class="node-editor-container"
      :class="{ 'is-main-node': isMainNode }"
      :style="containerStyle"
    >
      <editor-content :editor="editor" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, onBeforeUnmount, nextTick, computed, watch, type CSSProperties } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import type { Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { MindMapInstance, NodeObj } from '../../domain/types';
import { useMindMapStore } from '../../domain/store/mindmapStore';

const props = defineProps<{
  mind: MindMapInstance;
}>();

const store = useMindMapStore();
const visible = ref(false);
const editorContainer = ref<HTMLElement | null>(null);
const targetNode = shallowRef<NodeObj | null>(null);
const targetElement = shallowRef<HTMLElement | null>(null);

// 状态管理
const baseRect = ref({ top: 0, left: 0, width: 0, height: 0, centerX: 0, centerY: 0 });
const measuredSize = ref({ width: 0, height: 0 });
const nodeStyle = ref<Record<string, string>>({});
const computedBgColor = ref('var(--color-bg-default)');
const isMainNode = ref(false);
let resizeObserver: ResizeObserver | null = null;

const EDITOR_MAX_WIDTH = '35em';

// 容器样式计算
const containerStyle = computed((): CSSProperties => {
  const { width, height } = measuredSize.value;
  const { centerX, centerY } = baseRect.value;
  const scale = store.scale;
  
  // 核心逻辑：保持中心点不变，向四周扩展
  // width/height 是未缩放的 DOM 尺寸
  // centerX/centerY 是相对于容器的坐标（屏幕视觉位置）
  // 我们通过 transform: scale() 来匹配节点的缩放
  // transform-origin 默认为 center，所以中心点对齐即可
  const top = centerY - height / 2;
  const left = centerX - width / 2;

  return {
    top: `${top}px`,
    left: `${left}px`,
    // 还原原始尺寸作为最小尺寸，确保在缩放后视觉大小与原节点一致
    minWidth: `${baseRect.value.width / scale}px`,
    minHeight: `${baseRect.value.height / scale}px`,
    maxWidth: EDITOR_MAX_WIDTH,
    width: 'fit-content',
    height: 'auto',
    transform: `scale(${scale})`,
    // 确保变换基点为中心，这样缩放后中心点依然对齐
    transformOrigin: 'center center',
    ...nodeStyle.value,
    '--node-border-radius': nodeStyle.value.borderRadius || '0px',
    backgroundColor: computedBgColor.value, // 强制使用计算后的不透明背景色
    visibility: 'visible',
  };
});

type StartTextEditPayload = {
  node: NodeObj
  element: HTMLElement
  rect: {
    left: number
    top: number
    width: number
    height: number
  }
  style: {
    color: string
    fontSize: string
    fontFamily: string
    fontWeight: string
    textAlign: string
    lineHeight: string
    padding: string
    backgroundColor: string
    borderRadius: string
    border: string
  }
}

type StartNodeEditPayload = {
  nodeId: string
  trigger: 'mouse' | 'keyboard'
}

/**
 * 将节点 topic 文本转换为 TipTap 文档结构。
 *
 * 中文说明：
 * - **禁止**用 `<p><br></p>` 表示空行，因为 ProseMirror 会把 `<br>` 解析为 hardBreak，
 *   再叠加段落间的 blockSeparator，最终把一个空行膨胀成两次换行（表现为双击编辑瞬间多一行、节点变高）。
 * - 这里用“空 paragraph”表示空行，确保 `getText({ blockSeparator: '\n' })` 往返一致。
 */
const buildEditorContentFromTopic = (topicText: string): Content => {
  const lines = topicText.split('\n');
  const paragraphs = lines.map((line) => {
    if (line === '') {
      return { type: 'paragraph', content: [] };
    }
    return { type: 'paragraph', content: [{ type: 'text', text: line }] };
  });

  return {
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph', content: [] }],
  };
};

const startObserving = () => {
  if (editorContainer.value && !resizeObserver) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { offsetWidth, offsetHeight } = entry.target as HTMLElement;
        if (measuredSize.value.width !== offsetWidth || measuredSize.value.height !== offsetHeight) {
          measuredSize.value = { width: offsetWidth, height: offsetHeight };
        }
      }
    });
    resizeObserver.observe(editorContainer.value);
  }
};

const stopObserving = () => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
};

const editor = useEditor({
  content: '',
  extensions: [StarterKit],
  editorProps: {
    attributes: {
      class: 'node-editor-content',
    },
    handleKeyDown: (view, event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        finishEdit();
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
        return true;
      }
      return false;
    },
  },
  onBlur: () => {
    finishEdit();
  },
});

// 颜色处理工具
const clampAlpha = (value: number) => Math.min(1, Math.max(0, value));

type ParsedRgbaColor = { r: number; g: number; b: number; a: number };

const parseColorToRgba = (input: string | null | undefined): ParsedRgbaColor | null => {
  if (!input) return null;
  const value = input.trim();
  if (!value || value === 'transparent') return null;
  
  // Create a dummy element to let browser parse the color
  const div = document.createElement('div');
  div.style.color = value;
  document.body.appendChild(div);
  const computed = getComputedStyle(div).color;
  document.body.removeChild(div);

  return parseComputedRgbColor(computed);
};

const parseComputedRgbColor = (computed: string): ParsedRgbaColor | null => {
  if (!computed.startsWith('rgb')) return null;
  const start = computed.indexOf('(');
  const end = computed.lastIndexOf(')');
  if (start < 0 || end <= start) return null;

  const parts = computed
    .slice(start + 1, end)
    .replace(/[,/]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);

  if (parts.length < 3) return null;
  const red = Number(parts[0]);
  const green = Number(parts[1]);
  const blue = Number(parts[2]);
  const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
  if (![red, green, blue, alpha].every(Number.isFinite)) return null;

  return { r: red, g: green, b: blue, a: alpha };
};

const formatCssSrgbColor = (red: number, green: number, blue: number): string => {
  return `color(srgb ${red / 255} ${green / 255} ${blue / 255})`;
};

// 混合颜色以确保不透明: Color over White
const mixOnWhite = (color: ParsedRgbaColor): string => {
  if (color.a >= 1) return formatCssSrgbColor(color.r, color.g, color.b);
  const r = Math.round(color.r * color.a + 255 * (1 - color.a));
  const g = Math.round(color.g * color.a + 255 * (1 - color.a));
  const b = Math.round(color.b * color.a + 255 * (1 - color.a));
  return formatCssSrgbColor(r, g, b);
};

const isTransparentColor = (color: string | null | undefined): boolean => {
  const parsed = parseColorToRgba(color);
  return !parsed || parsed.a === 0;
};

const resolveBackgroundColor = (element: HTMLElement, style: Record<string, string>) => {
  // 1. 尝试直接读取样式
  let colorStr = style.backgroundColor;
  
  // 2. 如果是透明的，尝试读取 computed style
  if (isTransparentColor(colorStr)) {
    const computed = getComputedStyle(element);
    colorStr = computed.backgroundColor;
  }
  
  // 3. 特殊处理 mm-children mm-topic 的情况 (背景色在 ::before 上)
  if (isTransparentColor(colorStr)) {
    const before = getComputedStyle(element, '::before');
    if (before && !isTransparentColor(before.backgroundColor)) {
      // 这里需要考虑 opacity
      const opacity = parseFloat(before.opacity);
      const color = parseColorToRgba(before.backgroundColor);
      if (color) {
        color.a *= (Number.isNaN(opacity) ? 1 : opacity);
        return mixOnWhite(color);
      }
    }
    // 默认回退
    return 'var(--color-bg-default)';
  }

  // 4. 解析颜色并混合白色底色确保不透明
  const parsed = parseColorToRgba(colorStr);
  if (parsed) {
    return mixOnWhite(parsed);
  }
  
  return 'var(--color-bg-default)';
};

const startEdit = async (payload: StartTextEditPayload) => {
  const { node, element, style: rawNodeStyle } = payload as {
    node: NodeObj
    element: HTMLElement
    style: Record<string, string>
  };
  
  // 中文说明（根因修复：杜绝“开始编辑时闪一下”）：
  // - 旧实现会先把原节点 `visibility=hidden`，再把编辑器 `visible=true`（Vue patch 在 nextTick 才落 DOM）；
  // - 在某些机器/负载下会出现一帧“原节点消失但编辑器还没出现”的空窗，体感就是闪一下；
  // - 解决：先把编辑器显示出来（v-show 确保 DOM 常驻），等待下一轮 DOM patch 后再隐藏原节点。
  if (visible.value) {
    stopObserving();
    cleanupTargetElement();
    visible.value = false;
  }

  targetNode.value = node;
  targetElement.value = element;
  
  // 判断是否为主分支节点（二级节点）
  // 逻辑：在 mm-main 内，且不在 mm-children 内（排除三级及更深节点）
  isMainNode.value = !!element.closest('mm-main') && !element.closest('mm-children');

  // 计算位置
  const containerRect = props.mind.container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  
  const top = elementRect.top - containerRect.top;
  const left = elementRect.left - containerRect.left;
  const width = elementRect.width;
  const height = elementRect.height;

  baseRect.value = {
    top,
    left,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
  
  // 初始化尺寸
  measuredSize.value = { width, height };

  // 解析样式
  // 提取需要的样式属性以复制到编辑器
  nodeStyle.value = {
    color: rawNodeStyle.color,
    fontSize: rawNodeStyle.fontSize,
    fontFamily: rawNodeStyle.fontFamily,
    fontWeight: rawNodeStyle.fontWeight,
    textAlign: rawNodeStyle.textAlign || 'center', // 默认居中
    lineHeight: rawNodeStyle.lineHeight,
    padding: rawNodeStyle.padding,
    borderRadius: rawNodeStyle.borderRadius,
    border: rawNodeStyle.border,
    // 注意：不直接用 backgroundColor，单独计算
  };

  computedBgColor.value = resolveBackgroundColor(element, rawNodeStyle);

  // 设置内容
  const topicText = typeof node.topic === 'string' ? node.topic : '';

  const content = buildEditorContentFromTopic(topicText);
  editor.value?.commands.setContent(content, false);
  visible.value = true;
  
  await nextTick();
  // 在编辑器可见且已完成一次 DOM patch 后，再隐藏原节点，避免出现“空窗帧”
  element.style.visibility = 'hidden';
  editor.value?.commands.focus('end');
  startObserving();
};

/**
 * 纯 payload 入口：通过 nodeId 在组件内查找 DOM 与数据
 *
 * 中文说明：
 * - 这一步是“事件 payload 纯净化”的关键：跨层事件不传 HTMLElement/MouseEvent
 * - NodeEditor 属于 presentation 层，允许在本层做 DOM 查找（mind.findEle）
 */
const startEditByNodeId = (payload: StartNodeEditPayload) => {
  const root = props.mind.nodeData
  if (!root) return
  const node = props.mind.getObjById(payload.nodeId, root) as NodeObj | null
  if (!node) return

  let element: HTMLElement | null = null
  try {
    element = props.mind.findEle(payload.nodeId)
  } catch (err) {
    console.warn('[NodeEditor] startEditByNodeId failed: element not found', { nodeId: payload.nodeId, err })
    return
  }

  const style = getComputedStyle(element)
  const textEl = element.querySelector('.text') as HTMLElement | null
  const textStyle = textEl ? getComputedStyle(textEl) : style

  startEdit({
    node,
    element,
    rect: {
      left: 0,
      top: 0,
      width: element.offsetWidth,
      height: element.offsetHeight,
    },
    style: {
      color: textStyle.color,
      fontSize: textStyle.fontSize,
      fontFamily: textStyle.fontFamily,
      fontWeight: textStyle.fontWeight,
      textAlign: textStyle.textAlign,
      lineHeight: textStyle.lineHeight,
      padding: style.padding,
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      border: style.border,
    },
  })
}

const cleanupTargetElement = () => {
  if (targetElement.value) {
    targetElement.value.style.visibility = '';
  }
  targetElement.value = null;
};

const finishEdit = () => {
  if (!visible.value) return;
  
  const content = editor.value?.getText({ blockSeparator: '\n' }) || '';
  if (targetNode.value) {
    const trimmed = content.trim();
    // 即使内容没变，只要 trimmed 之后不为空，也可能需要刷新（比如去掉了空格）
    // 这里维持原逻辑：如果不为空且变了，更新
    if (trimmed && trimmed !== targetNode.value.topic) {
      const oldTopic = targetNode.value.topic;
      targetNode.value.topic = trimmed;
      
      // 更新 DOM (临时反馈)
      const topicEl = props.mind.findEle(targetNode.value.id);
      if (topicEl) {
        const textEl = topicEl.querySelector('.text');
        if (textEl) {
          if (props.mind.markdown) {
            textEl.innerHTML = props.mind.markdown(trimmed, targetNode.value);
          } else {
            textEl.textContent = trimmed;
          }
        }
      }
      // Use scheduler instead of direct linkDiv
      props.mind.requestReflow('node-edit:finish');
      props.mind.bus.fire('operation', {
        name: 'finishEdit',
        obj: targetNode.value,
        origin: oldTopic,
      });
    }
  }
  
  stopObserving();
  cleanupTargetElement();
  visible.value = false;
  targetNode.value = null;
  props.mind.container.focus();
};

const cancelEdit = () => {
  stopObserving();
  cleanupTargetElement();
  visible.value = false;
  targetNode.value = null;
  props.mind.container.focus();
};

const handleStartTextEdit = (payload: StartTextEditPayload) => {
  startEdit(payload);
};

const handleStartNodeEdit = (payload: StartNodeEditPayload) => {
  startEditByNodeId(payload)
}

watch(() => props.mind, (newMind, oldMind) => {
  if (oldMind?.bus?.removeListener) {
    // 中文说明：优先监听纯 payload 事件；旧事件保留兼容期
    oldMind.bus.removeListener('ui:startNodeEdit', handleStartNodeEdit);
  }
  if (newMind?.bus?.addListener) {
    // 中文说明：优先监听纯 payload 事件；旧事件保留兼容期
    newMind.bus.addListener('ui:startNodeEdit', handleStartNodeEdit);
  }
}, { immediate: true });

onBeforeUnmount(() => {
  if (props.mind?.bus?.removeListener) {
    props.mind.bus.removeListener('ui:startNodeEdit', handleStartNodeEdit);
  }
  stopObserving();
  cleanupTargetElement();
  editor.value?.destroy();
});
</script>
