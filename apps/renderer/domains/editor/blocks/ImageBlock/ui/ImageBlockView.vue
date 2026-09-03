<!-- src/renderer/features/ImageBlock/ui/ImageBlockView.vue -->
<template>
  <node-view-wrapper
    class="image-block-vue-node-view"
    :class="[
      `align-${node.attrs.alignment}`,
      { 'is-selected': selected }
    ]"
    ref="nodeViewWrapperRef"
  >
    <div class="image-container">
      <img
        v-if="!imageLoadFailed"
        :src="node.attrs.src"
        :alt="node.attrs.alt"
        :title="node.attrs.title"
        :style="imageStyle"
        @load="onImageLoad"
        @error="onImageError"
        @click.stop.prevent="selectImageBlock"
        ref="imageElement"
      />
      <button
        v-else
        type="button"
        class="image-missing-placeholder"
        contenteditable="false"
        @click.stop.prevent="selectImageBlock"
      >
        <span class="image-missing-placeholder__icon" aria-hidden="true"></span>
        <span class="image-missing-placeholder__text">{{ editorMessage('editor.imageBlock.missing') }}</span>
      </button>
      <div
        v-if="blockActivation.isUiActive.value && selected && imageLoaded && !imageLoadFailed"
        class="resize-handle"
        @mousedown.prevent.stop="onResizeStart"
      ></div>

      <!-- 控件栏：离屏时不挂载，降低渲染成本 -->
      <div v-if="blockActivation.isUiActive.value && editor.isEditable" class="image-block-controls" contenteditable="false">
        <!-- 响应式控件：小图显示省略号，大图显示完整控件 -->
        <template v-if="shouldShowCompactControls">
          <button
            class="control-button compact-more"
            :title="editorMessage('editor.imageBlock.action.more')"
            @click.stop.prevent="toggleControlsExpanded"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </button>
        </template>
        <template v-else>
          <!-- 预览按钮 -->
          <button class="control-button" :title="editorMessage('editor.imageBlock.action.preview')" @click.stop.prevent="openPreviewModal">
            <ZoomInIcon />
          </button>
          <!-- 调整尺寸按钮 -->
          <button class="control-button" :title="editorMessage('editor.imageBlock.action.resize')" @click.stop.prevent="openResizeModal">
            <ResizeIcon />
          </button>
          <!-- 对齐方式按钮组 -->
          <div class="alignment-group">
            <button class="control-button" :class="{ 'is-active': node.attrs.alignment === 'left' }" :title="editorMessage('editor.imageBlock.align.left')" @click.stop.prevent="setAlignment('left')">
              <AlignIcon alignment="left" />
            </button>
            <button class="control-button" :class="{ 'is-active': node.attrs.alignment === 'center' }" :title="editorMessage('editor.imageBlock.align.center')" @click.stop.prevent="setAlignment('center')">
              <AlignIcon alignment="center" />
            </button>
            <button class="control-button" :class="{ 'is-active': node.attrs.alignment === 'right' }" :title="editorMessage('editor.imageBlock.align.right')" @click.stop.prevent="setAlignment('right')">
              <AlignIcon alignment="right" />
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- 尺寸面板仍由编辑器控制；图片预览统一交给 shared 专用组件。 -->
    <Teleport to="body">
      <ImageResizePanel
        :is-visible="isResizeModalOpen"
        :initial-width="props.node.attrs.width"
        :initial-height="props.node.attrs.height"
        :natural-width="naturalImageWidth"
        :natural-height="naturalImageHeight"
        :position="resizePanelPosition"
        @confirm="handleResizeConfirm"
        @cancel="closeResizeModal"
      />

    </Teleport>
    <ImagePreviewModal
      :is-visible="isPreviewModalOpen"
      :src="node.attrs.src"
      :alt="node.attrs.alt || editorMessage('editor.imageBlock.action.preview')"
      @close="closePreviewModal"
      @error="closePreviewModal"
    />
  </node-view-wrapper>
</template>

<script setup>
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, inject } from 'vue';
import { Selection } from 'prosemirror-state';
import ImageResizePanel from './ImageResizePanel.vue';
import { ImagePreviewModal } from '@linnya/renderer-ui';
import { ZoomInIcon } from '@linnya/renderer-ui/icons';
import { ResizeIcon } from '@linnya/renderer-ui/icons';
import { AlignIcon } from '@linnya/renderer-ui/icons';
import { useCurrentBlockActivation } from '../../../ui/composables/useCurrentBlockActivation';
import {
  dispatchNodeViewRenderVirtualizationKeepAlive,
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
} from '../../../features/RenderVirtualization';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const props = defineProps(nodeViewProps);
const renderVirtualizationKeepAlivePort = inject(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, null);
const { editorMessage } = useEditorLocalization();

// 块激活状态：离屏时关闭控件栏和暂停 ResizeObserver
const blockActivation = useCurrentBlockActivation();

const nodeViewWrapperRef = ref(null);
const imageElement = ref(null);
const imageLoaded = ref(false);
const imageLoadFailed = ref(false);

// 响应式控件状态
const imageWidth = ref(0);
const controlsExpanded = ref(false);
const COMPACT_THRESHOLD = 200; // 图片宽度小于 200px 时显示紧凑控件
const MIN_WIDTH = 36; // 最小宽度
const MIN_HEIGHT = 36; // 最小高度

// 调整大小的状态变量
const resizing = ref(false);
const initialMouseX = ref(0);
const initialMouseY = ref(0);
const initialWidth = ref(0);
const initialHeight = ref(0);
const currentWidth = ref(0);
const naturalImageWidth = ref(0);
const naturalImageHeight = ref(0);

// 控制弹窗显示的状态
const isResizeModalOpen = ref(false);
const isPreviewModalOpen = ref(false);
const resizePanelPosition = ref({ top: 0, left: 0 });

// 响应式控件逻辑
const shouldShowCompactControls = computed(() => {
  return imageWidth.value > 0 && imageWidth.value < COMPACT_THRESHOLD && !controlsExpanded.value;
});

const toggleControlsExpanded = () => {
  controlsExpanded.value = !controlsExpanded.value;
  // 3秒后自动收起
  if (controlsExpanded.value) {
    setTimeout(() => {
      controlsExpanded.value = false;
    }, 3000);
  }
};

const updateImageWidth = () => {
  if (imageElement.value) {
    imageWidth.value = imageElement.value.offsetWidth || imageElement.value.clientWidth;
  }
};

const imageStyle = computed(() => {
  const styles = {};
  if (resizing.value) {
    if (currentWidth.value > 0) styles.width = `${currentWidth.value}px`;
    styles.height = 'auto';
  } else {
    const attrWidth = props.node.attrs.width;
    const attrHeight = props.node.attrs.height;
    if (attrWidth && attrWidth > 0) {
      styles.width = `${attrWidth}px`;
      styles.height = 'auto';
    } else if (attrHeight && attrHeight > 0) {
      styles.height = `${attrHeight}px`;
      styles.width = 'auto';
    }
  }
  return styles;
});

const onImageLoad = (event) => {
  imageLoaded.value = true;
  imageLoadFailed.value = false;
  const img = event.target;
  naturalImageWidth.value = img.naturalWidth;
  naturalImageHeight.value = img.naturalHeight;

  // 更新图片当前显示宽度
  nextTick(() => {
    updateImageWidth();
  });
};

const onImageError = () => {
  imageLoaded.value = false;
  imageLoadFailed.value = true;
};

const selectImageBlock = () => {
  // 如果已经选中，不重复设置
  if (props.selected) {
    return;
  }

  if (isResizeModalOpen.value) {
    closeResizeModal();
  }

  props.editor.commands.setNodeSelection(props.getPos());
};

const setAlignment = (alignment) => {
  if (props.node.attrs.alignment !== alignment) {
    props.updateAttributes({ alignment });
  }
};

const openResizeModal = async () => {
  // 计算面板位置
  const rect = nodeViewWrapperRef.value?.$el?.getBoundingClientRect();
  if (rect) {
    resizePanelPosition.value = {
      top: rect.bottom + 8,
      left: rect.left
    };
  } else {
    resizePanelPosition.value = {
      top: window.innerHeight / 2 - 100,
      left: window.innerWidth / 2 - 175
    };
  }

  isResizeModalOpen.value = true;
};

const closeResizeModal = () => {
  isResizeModalOpen.value = false;
};

const handleResizeConfirm = ({ width, height }) => {
  props.updateAttributes({
    width,
    height,
  });

  closeResizeModal();
};

const openPreviewModal = () => {
  if (imageLoadFailed.value) return;
  isPreviewModalOpen.value = true;
};

const closePreviewModal = () => {
  isPreviewModalOpen.value = false;
};

const setVirtualizationKeepAlive = (active) => {
  dispatchNodeViewRenderVirtualizationKeepAlive({
    target: nodeViewWrapperRef.value?.$el ?? null,
    editor: props.editor,
    getPos: props.getPos,
    reason: 'interaction-open',
    active,
    keepAlivePort: renderVirtualizationKeepAlivePort,
  });
};

const onResizeStart = (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!props.editor.isEditable) return;

  resizing.value = true;
  initialMouseX.value = event.clientX;
  initialMouseY.value = event.clientY;

  const imgElement = event.target.closest('.image-container').querySelector('img');
  if (imgElement) {
    initialWidth.value = imgElement.offsetWidth;
    initialHeight.value = imgElement.offsetHeight;
  } else {
    initialWidth.value = props.node.attrs.width || 0;
    initialHeight.value = props.node.attrs.height || 0;
  }
  currentWidth.value = initialWidth.value;

  window.addEventListener('mousemove', onResizeMove);
  window.addEventListener('mouseup', onResizeEnd);
};

const onResizeMove = (event) => {
  if (!resizing.value) return;
  event.preventDefault();
  event.stopPropagation();

  const deltaX = event.clientX - initialMouseX.value;
  let newWidth = initialWidth.value + deltaX;

  const MAX_WIDTH = 740;

  if (newWidth < MIN_WIDTH) {
    newWidth = MIN_WIDTH;
  } else if (newWidth > MAX_WIDTH) {
    newWidth = MAX_WIDTH;
  }

  currentWidth.value = newWidth;
};

const onResizeEnd = (event) => {
  if (!resizing.value) return;
  event.preventDefault();
  event.stopPropagation();

  const { updateAttributes } = props;
  const finalWidth = Math.round(currentWidth.value);

  if (finalWidth > 0 && naturalImageWidth.value > 0 && naturalImageHeight.value > 0) {
    const naturalAspectRatio = naturalImageHeight.value / naturalImageWidth.value;
    let finalHeight = Math.round(finalWidth * naturalAspectRatio);

    // 确保高度也不小于最小值
    if (finalHeight < MIN_HEIGHT) {
      finalHeight = MIN_HEIGHT;
      // 如果高度被限制，重新计算宽度以保持比例
      const adjustedWidth = Math.round(finalHeight / naturalAspectRatio);
      updateAttributes({ width: Math.max(adjustedWidth, MIN_WIDTH), height: finalHeight });
    } else {
      updateAttributes({ width: finalWidth, height: finalHeight });
    }
  } else if (finalWidth > 0) {
    updateAttributes({ width: finalWidth, height: null });
  }

  resizing.value = false;
  window.removeEventListener('mousemove', onResizeMove);
  window.removeEventListener('mouseup', onResizeEnd);
};

const handleGlobalKeyDown = (e) => {
  if (e.key === 'Escape') {
    if (isResizeModalOpen.value) closeResizeModal();
  }
};

const handleClickOutsideDocument = (event) => {
  const resizePanelEl = document.querySelector('.image-resize-panel');
  const isClickInsideResizePanel = isResizeModalOpen.value && resizePanelEl && resizePanelEl.contains(event.target);

  if (isClickInsideResizePanel) {
    return;
  }

  // 检查是否点击了 BlockActionMenu
  const blockActionMenuEl = document.querySelector('.block-action-menu-wrapper');
  const isClickInsideMenu = blockActionMenuEl && blockActionMenuEl.contains(event.target);

  // 只识别 BlockActionMenu 通过 Renderer UI 正式扩展面声明的业务 class。
  const submenuEl = document.querySelector('.block-action-menu-submenu');
  const isClickInsideSubmenu = submenuEl && submenuEl.contains(event.target);

  if (isClickInsideMenu || isClickInsideSubmenu) {
    return;
  }

  const currentNodeEl = nodeViewWrapperRef.value?.$el || null;
  const clickedInsideCurrentImage = !!(currentNodeEl && currentNodeEl.contains(event.target));
  if (clickedInsideCurrentImage) {
    // 点击发生在当前图片节点内部：不做任何处理，交给节点自身逻辑
    return;
  }

  // 找到点击目标最近的 .ProseMirror 祖先（可能是主编辑器或子编辑器）
  let closestEditor = event.target;
  while (closestEditor && !closestEditor.classList?.contains('ProseMirror')) {
    closestEditor = closestEditor.parentElement;
  }

  // 主编辑器的 DOM
  const mainEditorDom = props.editor?.view?.dom || null;

  // 判断点击的编辑器是否是主编辑器（直接比较 DOM 元素）
  const clickedInsideMainEditor = !!(closestEditor && mainEditorDom && closestEditor === mainEditorDom);
  const clickedInsideSubEditor = !!(closestEditor && mainEditorDom && closestEditor !== mainEditorDom);

  // 若点击在主编辑器内部（非子编辑器），完全不干预，避免光标跳动
  if (clickedInsideMainEditor) {
    return;
  }

  // 从这里开始：点击不在主编辑器内部
  // 我们仅在图片当前处于选中状态时，才尝试取消选中
  if (!props.selected) return;

  // 使用 nextTick，确保其他组件（如子编辑器）的事件先完成
  nextTick(() => {
    if (!props.selected || !props.editor || props.editor.isDestroyed) {
      return;
    }

    const { state, view } = props.editor;
    const endPos = Math.min(props.getPos() + props.node.nodeSize, state.doc.content.size);
    const $end = state.doc.resolve(endPos);

    // 子编辑器场景：点击发生在子编辑器内
    if (clickedInsideSubEditor) {
      // 仅通过 dispatch 选择变更来取消选中，不调用 focus，不抢占子编辑器焦点
      try {
        // 优先尝试在图片后方找到最近有效位置
        if ($end.parent.type.inlineContent) {
          const nearEnd = Selection.near($end);
          view.dispatch(state.tr.setSelection(nearEnd));
        } else {
          // 尝试在图片前方
          const $before = state.doc.resolve(Math.max(0, props.getPos()));
          const nearBefore = Selection.near($before, -1);
          view.dispatch(state.tr.setSelection(nearBefore));
        }
      } catch {
        // 回退：在文档开头寻找一个有效位置
        try {
          const $start = state.doc.resolve(0);
          const nearStart = Selection.near($start);
          view.dispatch(state.tr.setSelection(nearStart));
        } catch {
          props.editor.commands.blur();
        }
      }
      return;
    }

    // 非编辑器区域点击：安全地取消选中
    if ($end.parent.type.inlineContent) {
      view.dispatch(state.tr.setSelection(Selection.near($end)));
    } else {
      try {
        const $start = state.doc.resolve(0);
        const nearStart = Selection.near($start);
        view.dispatch(state.tr.setSelection(nearStart));
      } catch {
        props.editor.commands.blur();
      }
    }
  });
};

// ResizeObserver 用于监听图片尺寸变化
let resizeObserver = null;

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeyDown);
});

onBeforeUnmount(() => {
  setVirtualizationKeepAlive(false);
  document.removeEventListener('keydown', handleGlobalKeyDown);
  if (resizing.value) {
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', onResizeEnd);
  }
  document.removeEventListener('mousedown', handleClickOutsideDocument);

  // 清理 ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

// 根据激活状态控制 ResizeObserver：离屏时暂停，恢复时重新测量
watch(
  [imageElement, () => blockActivation.isUiActive.value],
  ([el, active]) => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    if (el && active) {
      resizeObserver = new ResizeObserver(() => {
        updateImageWidth();
      });
      resizeObserver.observe(el);
      updateImageWidth();
    }
  }
);

watch(() => props.selected, (isSelected, wasSelected) => {
  if (isSelected) {
    setTimeout(() => {
      if (props.selected) {
        document.addEventListener('mousedown', handleClickOutsideDocument);
      }
    }, 0);
  } else if (wasSelected) {
    document.removeEventListener('mousedown', handleClickOutsideDocument);
  }
});

watch(
  () => isResizeModalOpen.value || isPreviewModalOpen.value,
  (hasOpenInteraction) => {
    setVirtualizationKeepAlive(hasOpenInteraction);
  }
);

watch(
  () => props.node.attrs.src,
  () => {
    imageLoaded.value = false;
    imageLoadFailed.value = false;
  }
);
</script>
