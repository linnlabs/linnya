<template>
  <Transition name="panel-fade">
    <div
      v-show="visible"
      v-bind="attrs"
      ref="panelRef"
      class="draggable-panel"
      :class="`draggable-panel--${variant}`"
      :style="panelStyle"
      @mousedown.stop
      @touchstart.stop
    >
      <div
        class="panel-header"
        :class="classNames?.header"
        @mousedown.stop="onMouseDown"
      >
        <span class="panel-title" :class="classNames?.title">
          <slot name="title">{{ defaultTitle }}</slot>
        </span>
        <button
          class="close-btn"
          :class="classNames?.closeButton"
          :aria-label="closeLabel"
          :title="closeLabel"
          @click="emit('close')"
        >
          <CloseIcon />
        </button>
      </div>
      <div class="panel-body" :class="classNames?.body">
        <slot />
      </div>
      <template v-if="resizable && !isAutoWidth && !isAutoHeight">
        <div class="resize-handle resize-se" @mousedown.stop="onResizeStart($event, 'se')"></div>
        <div class="resize-handle resize-ne" @mousedown.stop="onResizeStart($event, 'ne')"></div>
        <div class="resize-handle resize-sw" @mousedown.stop="onResizeStart($event, 'sw')"></div>
        <div class="resize-handle resize-nw" @mousedown.stop="onResizeStart($event, 'nw')"></div>
      </template>
      <div
        v-if="resizable && !isAutoWidth"
        class="resize-handle resize-e"
        @mousedown.stop="onResizeStart($event, 'e')"
      ></div>
      <div
        v-if="resizable && !isAutoWidth"
        class="resize-handle resize-w"
        @mousedown.stop="onResizeStart($event, 'w')"
      ></div>
      <div
        v-if="resizable && !isAutoHeight"
        class="resize-handle resize-s"
        @mousedown.stop="onResizeStart($event, 's')"
      ></div>
      <div
        v-if="resizable && !isAutoHeight"
        class="resize-handle resize-n"
        @mousedown.stop="onResizeStart($event, 'n')"
      ></div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useAttrs,
  watch,
  type CSSProperties,
} from 'vue';
import { CloseIcon } from '../../../icons';
import { useSharedComponentLocalization } from '../../../localization';
import type {
  DraggablePanelBounds,
  DraggablePanelGeometry,
  DraggablePanelProps,
  DraggablePanelResizeDirection,
  DraggablePanelResizeState,
  DraggablePanelSize,
} from '../definitions/draggablePanel';
import {
  constrainDraggablePanelGeometry,
  normalizeDraggablePanelPositionOffset,
  parseDraggablePanelSize,
  resizeDraggablePanelGeometry,
  resolveDraggablePanelPosition,
} from '../functions/draggablePanelGeometry';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<DraggablePanelProps>(), {
  visible: false,
  width: '900px',
  height: '640px',
  resizable: true,
  containerSelector: null,
  initialPosition: 'center',
  variant: 'default',
  positionOffset: 16,
});

const emit = defineEmits<{
  close: [];
}>();

const attrs = useAttrs();
const { sharedComponentMessage } = useSharedComponentLocalization();
const defaultTitle = computed(() => sharedComponentMessage('shared.draggablePanel.title'));
const closeLabel = computed(() => sharedComponentMessage('shared.modal.close'));

const CONSTRAINTS = Object.freeze({
  MIN_WIDTH: 240,
  MIN_HEIGHT: 180,
  DEFAULT_WIDTH: 900,
  DEFAULT_HEIGHT: 640,
  EDGE_PADDING: 20,
  AUTO_MIN_HEIGHT: 200,
});
const MINIMUM_SIZE: DraggablePanelSize = Object.freeze({
  width: CONSTRAINTS.MIN_WIDTH,
  height: CONSTRAINTS.MIN_HEIGHT,
});

const panelRef = ref<HTMLElement | null>(null);
const x = ref(0);
const y = ref(0);
const width = ref<number>(CONSTRAINTS.DEFAULT_WIDTH);
const height = ref<number>(CONSTRAINTS.DEFAULT_HEIGHT);
const dragging = ref(false);
const dragOffset = ref({ x: 0, y: 0 });
const resizing = ref(false);
const resizeState = ref<DraggablePanelResizeState | null>(null);
let autoPositionTimer: ReturnType<typeof setTimeout> | null = null;

const isAutoHeight = computed(() => props.height === 'auto');
const isAutoWidth = computed(() => props.width === 'auto');
const normalizedOffset = computed(() => normalizeDraggablePanelPositionOffset(props.positionOffset));

const panelStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    left: `${x.value}px`,
    top: `${y.value}px`,
  };

  if (isAutoWidth.value) {
    style.width = 'auto';
    style.maxWidth = 'calc(100vw - 40px)';
  } else {
    style.width = `${width.value}px`;
  }

  if (isAutoHeight.value) {
    style.height = 'auto';
    style.maxHeight = 'calc(100vh - 40px)';
  } else {
    style.height = `${height.value}px`;
  }

  return style;
});

function getContainerBounds(): DraggablePanelBounds {
  if (props.containerSelector) {
    const container = document.querySelector(props.containerSelector);
    if (container) {
      const rect = container.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
  }

  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function getActualSize(): DraggablePanelSize {
  let actualWidth: number = width.value;
  let actualHeight: number = height.value;

  if (panelRef.value) {
    if (isAutoWidth.value) {
      actualWidth = panelRef.value.offsetWidth || CONSTRAINTS.MIN_WIDTH;
    }
    if (isAutoHeight.value) {
      actualHeight = panelRef.value.offsetHeight || CONSTRAINTS.MIN_HEIGHT;
    }
  }

  return { width: actualWidth, height: actualHeight };
}

function applyGeometry(geometry: DraggablePanelGeometry): void {
  x.value = geometry.x;
  y.value = geometry.y;
  width.value = geometry.width;
  height.value = geometry.height;
}

function constrainGeometry(geometry: DraggablePanelGeometry): DraggablePanelGeometry {
  return constrainDraggablePanelGeometry(geometry, getContainerBounds(), MINIMUM_SIZE);
}

function positionInitially(): void {
  const bounds = getContainerBounds();
  let initialWidth: number = isAutoWidth.value
    ? CONSTRAINTS.MIN_WIDTH
    : parseDraggablePanelSize(props.width, CONSTRAINTS.DEFAULT_WIDTH);
  let initialHeight: number = isAutoHeight.value
    ? CONSTRAINTS.AUTO_MIN_HEIGHT
    : parseDraggablePanelSize(props.height, CONSTRAINTS.DEFAULT_HEIGHT);

  if (!isAutoWidth.value) {
    initialWidth = Math.min(initialWidth, bounds.width - CONSTRAINTS.EDGE_PADDING);
  }
  if (!isAutoHeight.value) {
    initialHeight = Math.min(initialHeight, bounds.height - CONSTRAINTS.EDGE_PADDING);
  }

  const position = resolveDraggablePanelPosition(
    bounds,
    { width: initialWidth, height: initialHeight },
    props.initialPosition,
    normalizedOffset.value,
  );

  if (!isAutoWidth.value && !isAutoHeight.value) {
    applyGeometry(constrainDraggablePanelGeometry(
      { ...position, width: initialWidth, height: initialHeight },
      bounds,
      MINIMUM_SIZE,
    ));
    return;
  }

  x.value = position.x;
  y.value = position.y;
  if (!isAutoWidth.value) width.value = initialWidth;
  if (!isAutoHeight.value) height.value = initialHeight;
}

function onMouseDown(event: MouseEvent): void {
  if (resizing.value) return;
  // 面板常驻画布容器内，必须阻止宿主把拖拽起手误判成框选或平移。
  event.stopPropagation();
  dragging.value = true;
  dragOffset.value = { x: event.clientX - x.value, y: event.clientY - y.value };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  event.preventDefault();
}

function onMouseMove(event: MouseEvent): void {
  if (dragging.value && !resizing.value) {
    const actualSize = getActualSize();
    applyGeometry(constrainGeometry({
      x: event.clientX - dragOffset.value.x,
      y: event.clientY - dragOffset.value.y,
      width: actualSize.width,
      height: actualSize.height,
    }));
    return;
  }

  if (resizing.value && resizeState.value) {
    applyGeometry(resizeDraggablePanelGeometry(
      resizeState.value,
      { x: event.clientX, y: event.clientY },
      getContainerBounds(),
      MINIMUM_SIZE,
    ));
  }
}

function onMouseUp(): void {
  dragging.value = false;
  resizing.value = false;
  resizeState.value = null;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

function onResizeStart(event: MouseEvent, direction: DraggablePanelResizeDirection): void {
  event.stopPropagation();
  event.preventDefault();
  resizing.value = true;
  resizeState.value = {
    direction,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: width.value,
    startHeight: height.value,
    startPositionX: x.value,
    startPositionY: y.value,
  };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function scheduleAutoPosition(): void {
  if (autoPositionTimer !== null) clearTimeout(autoPositionTimer);
  autoPositionTimer = setTimeout(() => {
    autoPositionTimer = null;
    const position = resolveDraggablePanelPosition(
      getContainerBounds(),
      getActualSize(),
      props.initialPosition,
      normalizedOffset.value,
    );
    x.value = position.x;
    y.value = position.y;
  }, 10);
}

onMounted(positionInitially);

watch(() => props.visible, async (isVisible) => {
  if (!isVisible) return;
  positionInitially();
  if (isAutoWidth.value || isAutoHeight.value) {
    await nextTick();
    scheduleAutoPosition();
  }
});

onBeforeUnmount(() => {
  onMouseUp();
  if (autoPositionTimer !== null) clearTimeout(autoPositionTimer);
});
</script>
