<template>
  <section
    class="readonly-document-preview"
    :class="{ 'document-preview-more-below': moreBelow }"
    :aria-label="label || text('documentPreview.surface.label')"
    @mouseenter="engage('pointer')"
    @mouseleave="pointerInside = false"
    @focusin="engage('focus')"
    @focusout="leaveFocus"
  >
    <p
      v-if="controller.error.value"
      role="status"
    >
      {{ controller.error.value }}
    </p>
    <p
      v-else-if="detailOnly && !current"
      role="status"
    >
      {{ text('documentPreview.loading') }}
    </p>
    <Skeleton
      v-else-if="!detailOnly && !surface.body.value && surface.phase.value !== 'failed'"
      :label="text('documentPreview.loading')"
      :delayed="false"
    >
      <div
        class="readonly-document-preview__placeholder"
        :style="placeholderStyle"
      >
        <SkeletonBlock
          width="38%"
          height="12px"
        />
        <SkeletonBlock
          v-for="(width, index) in PLACEHOLDER_LINE_WIDTHS"
          :key="index"
          :width="width"
        />
      </div>
    </Skeleton>
    <p
      v-if="surface.phase.value === 'failed'"
      role="alert"
    >
      {{ text('documentPreview.detail.failed') }}
    </p>
    <div
      ref="viewport"
      class="readonly-document-preview__viewport"
      :style="viewportStyle"
      @click="preventPreviewNavigation"
      @scroll.passive="readMoreBelow"
    />
    <Teleport
      v-if="detailComponent && full && surface.body.value && current"
      :to="surface.body.value"
    >
      <component
        :is="detailComponent"
        :document-id="current.target.documentId"
        :project-id="current.target.projectId"
        :cover="current.preview.content?.image"
      />
    </Teleport>
    <button
      v-if="recovery"
      type="button"
      @click="controller.recover(recovery)"
    >
      {{ recovery.label }}
    </button>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { DOCUMENT_PREVIEW_LAYOUT } from '@linnya/document-preview';
import { Skeleton, SkeletonBlock } from '@linnya/renderer-ui';
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme';
import { useLocalization } from '@app/localization';
import { useNavigationScope } from '@/app/navigation';
import {
  readDocumentTypeIcon,
  readDocumentTypePreviewComponent,
  readDocumentTypeRecoveryAction,
} from '@/app/plugins/documentTypePresentation';
import type { DocumentPreviewTarget } from '../definitions/documentPreview';
import { DOCUMENT_PREVIEW_MESSAGE_FALLBACKS } from '../definitions/documentPreviewMessageCatalog';
import type { DocumentPreviewMessageKey } from '../definitions/documentPreviewMessages';
import { createDocumentPreviewController } from '../orchestration/createDocumentPreviewController';
import { createReadonlyDocumentSurface } from '../orchestration/createReadonlyDocumentSurface';
const props = defineProps<{
  readTarget: () => DocumentPreviewTarget;
  detailOnly?: boolean;
  label?: string;
  widthPx?: number;
}>();
const emit = defineEmits<{ ready: [] }>();
const { message, currentLocale } = useLocalization();
const text = (key: DocumentPreviewMessageKey) =>
  message(key, DOCUMENT_PREVIEW_MESSAGE_FALLBACKS[key]);
const scope = useNavigationScope(),
  full = ref(Boolean(props.detailOnly)),
  pointerInside = ref(false),
  focusInside = ref(false);
const viewport = ref<HTMLElement | null>(null),
  measuredWidth = ref(0),
  moreBelow = ref(false);
const theme = ref<'light' | 'dark'>('light');
// 只差底部留白时不算有下文，和首屏的裁切判断一致，选中前后画面不跳。
function readMoreBelow() {
  const element = viewport.value;
  if (!element) return;
  moreBelow.value =
    element.scrollHeight - element.clientHeight - element.scrollTop >
    DOCUMENT_PREVIEW_LAYOUT.paddingBottom + 1;
}
const controller = createDocumentPreviewController(props.readTarget, () => scope.currentProjectId),
  current = controller.result;
const surface = createReadonlyDocumentSurface({
  element: () => viewport.value,
  ready: () => {
    readMoreBelow();
    emit('ready');
  },
  report: failure => console.warn('[document-preview] presentation failed', failure),
});
const recovery = computed(() => {
  void currentLocale.value; // 按钮文字随界面语言重算
  return current.value?.presentation.status === 'plugin_unavailable' && current.value.presentation.nodeType
    ? readDocumentTypeRecoveryAction(current.value.presentation.nodeType)
    : null;
});
const detailComponent = computed(() =>
  current.value?.presentation.status === 'available' &&
  current.value.preview.status === 'ready' &&
  current.value.presentation.nodeType
    ? readDocumentTypePreviewComponent(current.value.presentation.nodeType)
    : null
);
// 首屏被截断、或类型有自己的详情时，全文还没在眼前；否则不必再排一遍。
const moreThanFirstScreen = computed(
  () => surface.firstScreen.value && (Boolean(detailComponent.value) || surface.clipped.value)
);
// 悬停面板露出后尺寸不再变：滚动区的最大高度就是首屏高度，全文换进来只是多了可滚动的下文。
// 所以没有“展开”这个动作，指针进入或键盘焦点进入（方向键滚动要先有全文）时在原地把首屏换成全文。
// 不在首屏排好后立刻换：只是路过的悬停不该为一篇长文付整篇排版的开销。
function engage(source: 'pointer' | 'focus') {
  if (source === 'pointer') pointerInside.value = true;
  else focusInside.value = true;
  if (moreThanFirstScreen.value) full.value = true;
}
function leaveFocus(event: FocusEvent) {
  const next = event.relatedTarget;
  if (
    event.currentTarget instanceof Element &&
    next instanceof Node &&
    event.currentTarget.contains(next)
  )
    return;
  focusInside.value = false;
}
// 近景（detailOnly）铺满消费方给的容器，不限高。
const viewportStyle = props.detailOnly
  ? undefined
  : { maxHeight: `${DOCUMENT_PREVIEW_LAYOUT.firstScreenHeight}px` };
// 读取较慢时的占位：与首屏同宽、同内边距、同高，内容到来时面板不再变宽，长文也不变高。
const PLACEHOLDER_LINE_WIDTHS = ['92%', '100%', '84%', '96%', '70%', '100%', '88%', '94%', '100%', '76%', '100%', '58%'] as const;
const placeholderStyle = {
  height: `${DOCUMENT_PREVIEW_LAYOUT.firstScreenHeight}px`,
  padding: `${DOCUMENT_PREVIEW_LAYOUT.paddingTop}px ${DOCUMENT_PREVIEW_LAYOUT.paddingInline}px ${DOCUMENT_PREVIEW_LAYOUT.paddingBottom}px`,
};
function preventPreviewNavigation(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a')) event.preventDefault();
}
// 使用未变换的布局宽度；画布相机缩放不能改变正文的换行。
let resize: ResizeObserver | undefined, appearance: MutationObserver | undefined;
onMounted(() => {
  const root = document.documentElement;
  const readTheme = () => {
    theme.value = root.getAttribute(RENDERER_UI_THEME_ATTRIBUTE) === 'dark' ? 'dark' : 'light';
  };
  readTheme();
  appearance = new MutationObserver(readTheme);
  appearance.observe(root, { attributes: true, attributeFilter: [RENDERER_UI_THEME_ATTRIBUTE] });
  resize = new ResizeObserver(entries => {
    const entry = entries[0];
    if (entry) measuredWidth.value = entry.contentRect.width;
    readMoreBelow();
  });
  if (viewport.value) resize.observe(viewport.value);
});
watchEffect(() => {
  void controller.refresh();
});
// 内容换了从首屏重新开始，除非用户正在面板里读。
watch(current, () => {
  full.value = Boolean(props.detailOnly || pointerInside.value || focusInside.value);
});
watch(
  [current, full, theme, measuredWidth, () => props.widthPx, currentLocale],
  () => {
    const identity = current.value,
      width = props.widthPx ?? measuredWidth.value;
    if (!identity || width <= 0) {
      surface.clear();
      return;
    }
    void surface.render(
      {
        preview: identity.preview,
        widthPx: width,
        maxHeight: full.value ? undefined : DOCUMENT_PREVIEW_LAYOUT.firstScreenHeight,
        // 短文按内容高度，不留一截空白；长文仍停在首屏高度。
        fitContentHeight: true,
        theme: theme.value,
        locale: currentLocale.value,
        icon: identity.presentation.nodeType
          ? readDocumentTypeIcon(identity.presentation.nodeType)
          : null,
        referenceTypeIcon: readDocumentTypeIcon,
        externalBody: full.value && Boolean(detailComponent.value),
        onOpen:
          identity.presentation.status === 'available'
            ? () => {
                void controller.open(identity);
              }
            : undefined,
      },
      () => controller.isCurrent(identity)
    );
  },
  { flush: 'post' }
);
onBeforeUnmount(() => {
  resize?.disconnect();
  appearance?.disconnect();
  surface.clear();
  controller.dispose();
});
</script>
