<!-- apps/renderer/features/AiAssistant/ui/components/timeline/TimelineNav.vue -->
<template>
  <div 
    class="timeline-nav" 
    :class="{ 'is-collapsed': isCollapsed }"
    :inert="isCollapsed"
    :aria-hidden="isCollapsed ? 'true' : undefined"
    ref="timelineRef"
  >
    <!-- 时间轴轨道 -->
    <div
      ref="trackRef"
      class="timeline-track"
      :class="{ 'is-overflow': isOverflow }"
      @scroll.passive="handleTrackScroll"
      @mouseenter="handleTrackMouseEnter"
      @mouseleave="handleTrackMouseLeave"
      @wheel="handleTrackWheel"
    >
      <div
        class="timeline-track-content"
        :class="{ 'has-multiple-markers': markers.length > 1 }"
        :style="trackContentStyle"
      >
        <!-- 渲染所有标记点 -->
        <TimelineDot
          v-for="marker in markersWithPositions"
          :key="marker.visualTurnId"
          :visual-turn-id="marker.visualTurnId"
          :summary="marker.summary"
          :normalizedPosition="marker.position"
          :isActive="marker.visualTurnId === activeVisualTurnId"
          :disabled="isCollapsed"
          @click="handleDotClick"
          @mouseenter="(e) => handleDotHover(marker, e)"
          @mouseleave="handleDotLeave"
        />
      </div>
    </div>

    <!-- 工具提示 -->
    <Teleport to="body">
      <TimelineTooltip
        v-if="tooltipVisible && !isCollapsed"
        :text="tooltipText"
        :x="tooltipX"
        :y="tooltipY"
        :placement="tooltipPlacement"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch, toRef, type CSSProperties, type Ref } from 'vue';
import type { TimelineMarker } from '../../../features/timeline';
import TimelineDot from './TimelineDot.vue';
import TimelineTooltip from './TimelineTooltip.vue';
import { useTimelinePositions, type PositionInfo } from './composables/useTimelinePositions';
import { useTimelineSync } from './composables/useTimelineSync';
import type {
  ConversationCompleteVisualTurnId,
  ConversationVisualTurnId,
} from '@app/schemas';

/**
 * 功能 (What): 时间轴导航主容器组件
 * 输入 (Input): 从 ConversationView 接收轮次列表和位置信息
 * 输出 (Output): 渲染时间轴UI，提供导航功能
 * 副作用 (Side-effects): 监听滚动事件，发送跳转命令
 */

// Props
interface Props {
  markers?: readonly TimelineMarker[];
  scrollContainer?: HTMLElement | null;
  positions?: PositionInfo[];
  isCollapsed?: boolean;
}

interface TimelineMarkerWithPosition extends TimelineMarker {
  position: number;
}

const props = withDefaults(defineProps<Props>(), {
  markers: () => [],
  isCollapsed: false,
});

// Emits
const emit = defineEmits<{
  'navigate-to-visual-turn': [marker: TimelineMarker];
}>();

// Refs
const timelineRef = ref<HTMLElement | null>(null);
const trackRef = ref<HTMLElement | null>(null);
const trackHeight = ref(600); // 初始高度，会在 mounted 后更新
const trackScrollTop = ref(0);
const isTrackHovered = ref(false);
const TIMELINE_TRACK_PADDING_PX = 12;
const TIMELINE_MARKER_GAP_PX = 20;
const TIMELINE_MARKER_OVERSCAN = 8;

const markers = toRef(props, 'markers');

// 使用 composables
const scrollContainerRef = computed(() => props.scrollContainer);
const { updateTurnPositions, visualTurnPositions, calculatedPositions } = useTimelinePositions(
  markers,
  trackHeight
);
const { activeVisualTurnId, scheduleScrollSync, setActiveVisualTurn, cleanup } = useTimelineSync({
  scrollContainer: scrollContainerRef as Ref<HTMLElement | null>,
  onActiveChange: ensureActiveMarkerVisible,
});

const overflowContentHeight = computed(() => (
  markers.value.length <= 1
    ? 2 * TIMELINE_TRACK_PADDING_PX
    : 2 * TIMELINE_TRACK_PADDING_PX + (markers.value.length - 1) * TIMELINE_MARKER_GAP_PX
));
const isOverflow = computed(() => overflowContentHeight.value > trackHeight.value);
const trackContentStyle = computed<CSSProperties>(() => (
  isOverflow.value ? { height: `${overflowContentHeight.value}px` } : {}
));

function readOverflowMarkerRange(): { start: number; end: number } {
  const count = markers.value.length;
  if (count === 0) return { start: 0, end: -1 };
  const viewportHeight = trackRef.value?.clientHeight ?? trackHeight.value;
  const firstVisible = Math.floor(
    Math.max(trackScrollTop.value - TIMELINE_TRACK_PADDING_PX, 0) / TIMELINE_MARKER_GAP_PX,
  );
  const visibleCount = Math.ceil(viewportHeight / TIMELINE_MARKER_GAP_PX);
  return {
    start: Math.max(firstVisible - TIMELINE_MARKER_OVERSCAN, 0),
    end: Math.min(firstVisible + visibleCount + TIMELINE_MARKER_OVERSCAN, count - 1),
  };
}

// 短会话沿用真实几何归一化；overflow 模式只计算可见 marker，正文滚动不再 patch 全量 dot。
const markersWithPositions = computed<TimelineMarkerWithPosition[]>(() => {
  if (isOverflow.value) {
    const { start, end } = readOverflowMarkerRange();
    const lastIndex = Math.max(markers.value.length - 1, 1);
    return markers.value.slice(start, end + 1).map((marker, offset) => ({
      ...marker,
      position: (start + offset) / lastIndex,
    }));
  }

  const positions = calculatedPositions.value;
  const positionByVisualTurnId = new Map(
    positions.map(position => [position.visualTurnId, position.n]),
  );
  return markers.value.map((marker) => {
    return {
      ...marker,
      position: positionByVisualTurnId.get(marker.visualTurnId) ?? 0,
    };
  });
});

// 工具提示状态
const tooltipVisible = ref(false);
const tooltipText = ref('');
const tooltipX = ref(0);
const tooltipY = ref(0);
const tooltipPlacement = ref<'left' | 'right'>('right');
let tooltipHideTimer: number | null = null;
let detachScrollListener: (() => void) | null = null;

/**
 * @description
 * 滚动监听必须跟随真实滚动容器动态重绑。
 *
 * 根因：
 * - 时间轴组件有时先于 `ConversationHost` 完成真实滚动容器解析；
 * - 如果只在 mounted 时绑定一次，后续 `scrollContainer` 从 null 变成 HTMLElement 时不会补绑；
 * - 结果就是手动滚动不会触发 activeTurn 同步，高亮会停留在旧状态。
 */
function bindScrollListener(container: HTMLElement | null | undefined) {
  if (detachScrollListener) {
    detachScrollListener();
    detachScrollListener = null;
  }

  if (!container) return;

  const handleScroll = () => {
    if (visualTurnPositions.value.size > 0) {
      scheduleScrollSync(new Map(visualTurnPositions.value));
    }
  };

  container.addEventListener('scroll', handleScroll, { passive: true });
  detachScrollListener = () => {
    container.removeEventListener('scroll', handleScroll);
  };
}

/**
 * 处理标记点点击
 */
function handleDotClick(visualTurnId: ConversationCompleteVisualTurnId) {
  const marker = markers.value.find(candidate => candidate.visualTurnId === visualTurnId);
  if (!marker) return;
  setActiveVisualTurn(visualTurnId);
  emit('navigate-to-visual-turn', marker);
}

function handleTrackScroll(): void {
  trackScrollTop.value = trackRef.value?.scrollTop ?? 0;
}

function handleTrackWheel(event: WheelEvent): void {
  if (isOverflow.value) event.stopPropagation();
}

function handleTrackMouseEnter(): void {
  isTrackHovered.value = true;
}

function handleTrackMouseLeave(): void {
  isTrackHovered.value = false;
  handleDotLeave();
  ensureActiveMarkerVisible(activeVisualTurnId.value);
}

function ensureActiveMarkerVisible(visualTurnId: ConversationVisualTurnId | null): void {
  const track = trackRef.value;
  if (!visualTurnId || !track || !isOverflow.value || isTrackHovered.value) return;
  const markerIndex = markers.value.findIndex(marker => marker.visualTurnId === visualTurnId);
  if (markerIndex < 0) return;

  const markerTop = TIMELINE_TRACK_PADDING_PX + markerIndex * TIMELINE_MARKER_GAP_PX;
  const viewportTop = track.scrollTop;
  const viewportBottom = viewportTop + track.clientHeight;
  if (markerTop < viewportTop + TIMELINE_TRACK_PADDING_PX) {
    track.scrollTop = Math.max(markerTop - TIMELINE_TRACK_PADDING_PX, 0);
  } else if (markerTop > viewportBottom - TIMELINE_TRACK_PADDING_PX) {
    track.scrollTop = Math.max(markerTop - track.clientHeight + TIMELINE_TRACK_PADDING_PX, 0);
  }
  trackScrollTop.value = track.scrollTop;
}

/**
 * 处理标记点悬浮
 */
function handleDotHover(marker: TimelineMarkerWithPosition, event: MouseEvent) {
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }

  const target = event.target as HTMLElement;
  const rect = target.getBoundingClientRect();
  const timelineRect = timelineRef.value?.getBoundingClientRect();

  if (!timelineRect) return;

  // 决定工具提示的位置
  const spaceOnRight = window.innerWidth - rect.right;
  tooltipPlacement.value = spaceOnRight > 300 ? 'right' : 'left';

  // 设置位置
  if (tooltipPlacement.value === 'right') {
    tooltipX.value = rect.right + 12;
  } else {
    tooltipX.value = rect.left - 12;
  }
  tooltipY.value = rect.top + rect.height / 2;

  // 设置文本 - 限制最大长度为 120 个字符
  const MAX_TOOLTIP_LENGTH = 120;
  const summary = marker.summary || '';
  tooltipText.value = summary.length > MAX_TOOLTIP_LENGTH 
    ? summary.substring(0, MAX_TOOLTIP_LENGTH) + '...' 
    : summary;

  tooltipVisible.value = true;
}

/**
 * 处理标记点离开
 */
function handleDotLeave() {
  tooltipHideTimer = window.setTimeout(() => {
    tooltipVisible.value = false;
    tooltipHideTimer = null;
  }, 100);
}

/**
 * 更新轨道高度
 */
function updateTrackHeight() {
  if (trackRef.value) {
    trackHeight.value = trackRef.value.clientHeight;
  }
}

const TIMELINE_VISUAL_ANIMATION_DURATION_MS = 240;
const TIMELINE_VISUAL_ANIMATION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
let visualAnimation: Animation | null = null;

function readPixelVariable(element: HTMLElement, propertyName: string, fallback: number): number {
  const rawValue = getComputedStyle(element).getPropertyValue(propertyName).trim();
  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : fallback;
}

function readCurrentTranslateX(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none') return 0;
  try {
    return new DOMMatrixReadOnly(transform).m41;
  } catch {
    return 0;
  }
}

function readCurrentOpacity(element: HTMLElement): number {
  const opacity = Number.parseFloat(getComputedStyle(element).opacity);
  return Number.isFinite(opacity) ? Math.max(0, Math.min(opacity, 1)) : 1;
}

function cancelVisualAnimation(): void {
  if (!visualAnimation) return;
  visualAnimation.cancel();
  visualAnimation = null;
}

function resolveCollapsedTranslateX(element: HTMLElement): number {
  return readPixelVariable(element, '--timeline-width', 28);
}

function applyTimelineVisualState(collapsed: boolean, animate: boolean): void {
  const element = timelineRef.value;
  if (!element) return;

  const targetTranslateX = collapsed ? resolveCollapsedTranslateX(element) : 0;
  const targetOpacity = collapsed ? 0 : 1;
  const startTranslateX = readCurrentTranslateX(element);
  const startOpacity = readCurrentOpacity(element);

  cancelVisualAnimation();

  if (!animate || typeof element.animate !== 'function') {
    element.style.transform = `translateX(${String(targetTranslateX)}px)`;
    element.style.opacity = String(targetOpacity);
    return;
  }

  if (Math.abs(startTranslateX - targetTranslateX) < 0.5 && Math.abs(startOpacity - targetOpacity) < 0.01) {
    element.style.transform = `translateX(${String(targetTranslateX)}px)`;
    element.style.opacity = String(targetOpacity);
    return;
  }

  // timeline 本体是纯视觉进出；用 WAA 避免 sticky/grid 结构下 CSS transition 偶发不触发。
  element.style.transform = `translateX(${String(startTranslateX)}px)`;
  element.style.opacity = String(startOpacity);

  const animation = element.animate(
    [
      {
        transform: `translateX(${String(startTranslateX)}px)`,
        opacity: startOpacity,
      },
      {
        transform: `translateX(${String(targetTranslateX)}px)`,
        opacity: targetOpacity,
      },
    ],
    {
      duration: TIMELINE_VISUAL_ANIMATION_DURATION_MS,
      easing: TIMELINE_VISUAL_ANIMATION_EASING,
    },
  );

  visualAnimation = animation;
  animation.onfinish = () => {
    element.style.transform = `translateX(${String(targetTranslateX)}px)`;
    element.style.opacity = String(targetOpacity);
    if (visualAnimation === animation) {
      visualAnimation = null;
    }
    animation.cancel();
  };
}

/**
 * 接收来自 ConversationView 的位置更新
 */
function receivePositionUpdate(positions: PositionInfo[]) {
  updateTurnPositions(positions);

  if (props.isCollapsed) return;
  
  // 创建位置映射用于滚动同步
  const posMap = new Map(positions.map(p => [p.visualTurnId, p.top]));
  scheduleScrollSync(posMap);
}

watch(
  () => props.positions,
  (positions) => {
    if (!Array.isArray(positions) || positions.length === 0) {
      updateTurnPositions([]);
      return;
    }
    receivePositionUpdate(positions);
  },
  { immediate: true, deep: false }
);

watch(
  () => props.scrollContainer,
  (container) => {
    bindScrollListener(container);
    if (container && visualTurnPositions.value.size > 0) {
      scheduleScrollSync(new Map(visualTurnPositions.value));
    }
  },
  { immediate: true }
);

watch(
  () => props.isCollapsed,
  (collapsed) => {
    applyTimelineVisualState(collapsed, true);
    if (collapsed) return;
    if (visualTurnPositions.value.size > 0) {
      scheduleScrollSync(new Map(visualTurnPositions.value));
    }
  },
  { flush: 'post' }
);

watch(
  () => [isOverflow.value, markers.value.length] as const,
  async () => {
    await nextTick();
    ensureActiveMarkerVisible(activeVisualTurnId.value);
  },
  { flush: 'post' },
);

// 监听窗口大小变化
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  updateTrackHeight();
  applyTimelineVisualState(props.isCollapsed, false);
  
  // 监听时间轴容器大小变化
  if (timelineRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateTrackHeight();
    });
    resizeObserver.observe(timelineRef.value);
  }
  
});

onUnmounted(() => {
  cleanup();
  cancelVisualAnimation();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
  }
  
  // 🆕 清理滚动监听器
  if (detachScrollListener) {
    detachScrollListener();
    detachScrollListener = null;
  }
});

</script>
