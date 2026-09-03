<template>
  <!--
    通用 subrun_trace 过程面板（样式/交互与 Deep Search 保持一致）。
    - 只使用 subrun_trace 实时过程与其 durable replay（append-only）
    - 历史态允许仅凭 lazySource 展示折叠 header，点击展开后再拉取过程
  -->
  <div
    v-if="enabled && (subrunBucket || lazySource)"
    class="subrun-trace-panel deep-trace"
    :class="{
      'subrun-trace-panel--completed': status === 'success' && showTopDivider,
      'subrun-trace-panel--collapsible': disclosureMode === 'collapsible',
      'subrun-trace-panel--static-expanded': disclosureMode === 'static-expanded',
      'deep-trace--completed': status === 'success' && showTopDivider,
    }"
  >
    <div class="deep-trace__header" @click="toggleTrace">
      <span class="deep-trace__title">{{ panelTitle }}</span>
      <span class="deep-trace__meta" v-if="stepCount !== undefined">
        {{ conversationMessage('conversation.tool.subrunTrace.stepCount', { count: stepCount }) }}
      </span>
      <span v-if="$slots.actions" class="deep-trace__actions" @click.stop>
        <slot name="actions" />
      </span>
      <span v-if="disclosureMode === 'collapsible'" class="deep-trace__toggle">
        {{ isExpanded ? conversationMessage('conversation.tool.subrunTrace.collapse') : conversationMessage('conversation.tool.subrunTrace.expand') }}
      </span>
    </div>

    <div v-if="hasVisibleBodyContent" v-show="isBodyVisible" class="deep-trace__body">
      <!-- 1) SubRun Trace Channel：实时增量过程 -->
      <template v-if="subrunSteps.length > 0">
        <div
          v-for="(s, idx) in subrunSteps"
          :key="s.toolCallId"
          class="deep-trace__row"
          :class="{
            'has-next': idx < subrunSteps.length - 1,
            'is-active': status === 'loading' && idx === subrunSteps.length - 1
          }"
        >
          <div class="deep-trace__marker">
            <div class="deep-trace__line"></div>
            <div class="deep-trace__dot-wrapper">
              <span class="deep-trace__dot" :class="`is-${s.status}`"></span>
            </div>
          </div>
          <span class="deep-trace__tool" :title="resolveCompactStepTitle(s.title)">
            {{ resolveCompactStepTitle(s.title) }}
          </span>
          <span v-if="s.durationMs !== undefined" class="deep-trace__duration">{{ s.durationMs }}ms</span>
        </div>
      </template>

      <button
        v-else-if="lazyStatus === 'error'"
        class="deep-trace__retry"
        type="button"
        @click.stop="retryLazyTrace"
      >
        {{ conversationMessage('conversation.tool.subrunTrace.retry') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useLocalization } from '@app/localization';
import type { ToolLocalizedTextDescriptor } from '@linnya/plugin-host-contract/renderer/toolUi';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { HistoricalSubrunTraceLazySource } from '../definitions/subrunTrace';
import type { SubrunTraceDisclosureMode } from '../definitions/subrunTracePresentation';
import { createAppendOnlySubrunStepProjector } from '../functions/createAppendOnlySubrunStepProjector';
import { readSubrunTraceSourceKey } from '../functions/hasSubrunTraceBucket';
import { useAppendOnlySubrunTrace } from '../orchestration/useAppendOnlySubrunTrace';
import { useLazySubrunTrace } from '../orchestration/useLazySubrunTrace';
import { useSubrunTraceInvalidationStore } from '../store/subrunTraceInvalidationStore';
import { useSubrunTraceHistoryCacheStore } from '../store/subrunTraceHistoryCacheStore';
import { useSubrunTraceAccumulator } from '../orchestration/useSubrunTraceAccumulator';

function readNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

const props = withDefaults(
  defineProps<{
    status: string;
    enabled: boolean;
    subrunTrace?: unknown;
    subrunTraceVersion?: number;
    titleExecuting?: string;
    titleCompleted?: string;
    lazySource?: HistoricalSubrunTraceLazySource;
    /**
     * 顶部分割线（完成态）的展示开关。
     *
     * 中文备注（语义约束）：
     * - Deep Search：trace 面板通常位于结果区下方，完成态用分割线分隔上下文，默认开启；
     * - 普通 subrun：父工具卡内只有过程摘要，若仍展示分割线会显得突兀，因此允许关闭。
     */
    showTopDivider?: boolean;
    /**
     * Deep Search 使用 collapsible；普通 subrun 使用 static-expanded，并由详情入口承接完整内容。
     */
    disclosureMode: SubrunTraceDisclosureMode;
  }>(),
  {
    subrunTrace: undefined,
    subrunTraceVersion: 0,
    titleExecuting: undefined,
    titleCompleted: undefined,
    lazySource: undefined,
    showTopDivider: true,
  }
);

const { conversationMessage } = useConversationLocalization();
const { t: resolveLocalizedText } = useLocalization();

/**
 * append-only 派生缓存
 */
const traceInvalidationStore = useSubrunTraceInvalidationStore();
const traceHistoryCache = useSubrunTraceHistoryCacheStore();
const lazyTrace = useLazySubrunTrace(
  () => props.lazySource,
  undefined,
  () => {
    const source = props.lazySource;
    return source
      ? traceInvalidationStore.revisionFor(source.conversationId)
      : 0;
  },
  traceHistoryCache,
);
const subrunStepProjector = createAppendOnlySubrunStepProjector();
const subrunSteps = shallowRef(subrunStepProjector.projection.steps);

function resolveCompactStepTitle(title: ToolLocalizedTextDescriptor): string {
  return resolveLocalizedText(title);
}

const accumulatedTrace = useSubrunTraceAccumulator({
  sourceKey: () => {
    const source = props.lazySource;
    return source
      ? `${source.conversationId}|${source.parentToolCallId}|${source.subrunId ?? ''}`
      : readSubrunTraceSourceKey(props.subrunTrace) ?? 'unscoped-panel';
  },
  liveTrace: () => props.subrunTrace,
  liveVersion: () => props.subrunTraceVersion,
  historicalTrace: () => lazyTrace.buckets.value,
  historicalVersion: () => lazyTrace.version.value,
});

const { bucket: subrunBucket } = useAppendOnlySubrunTrace({
  subrunTrace: () => accumulatedTrace.trace.value,
  version: () => accumulatedTrace.version.value,
  subrunId: () => props.lazySource?.subrunId ?? '',
  onReset: () => {
    subrunStepProjector.reset();
    subrunSteps.value = subrunStepProjector.projection.steps;
  },
  onEvents: events => {
    subrunStepProjector.admit(events);
    subrunSteps.value = subrunStepProjector.projection.steps;
  },
  onAdmissionError: error => {
    console.error('[SubrunTracePanel] 紧凑步骤接纳失败', {
      bucketId: error.bucketId,
      processedLength: error.processedLength,
      targetLength: error.targetLength,
      traceVersion: error.traceVersion,
      fingerprint: error.fingerprint,
      sourceToolName: error.projection?.sourceToolName,
      uiKey: error.projection?.uiKey,
      toolCallId: error.projection?.toolCallId,
      error: error.cause instanceof Error ? error.cause.message : String(error.cause),
    });
  },
});

const lazyStatus = computed(() => lazyTrace.status.value);

const stepCount = computed<number | undefined>(() => {
  const count = subrunSteps.value.length;
  return count > 0 ? count : undefined;
});

const panelTitle = computed(() => {
  const tExecuting = readNonEmptyString(props.titleExecuting);
  const tCompleted = readNonEmptyString(props.titleCompleted);
  if (props.status === 'loading') return tExecuting ?? conversationMessage('conversation.tool.subrunTrace.defaultExecuting');
  return tCompleted ?? conversationMessage('conversation.tool.subrunTrace.defaultCompleted');
});

const isExpanded = ref(false);
const isBodyVisible = computed(
  () => props.disclosureMode === 'static-expanded' || isExpanded.value,
);
const hasVisibleBodyContent = computed(
  () => subrunSteps.value.length > 0
    || lazyStatus.value === 'error',
);
function toggleTrace(): void {
  if (props.disclosureMode !== 'collapsible') return;
  const nextExpanded = !isExpanded.value;
  isExpanded.value = nextExpanded;
  if (nextExpanded) {
    void ensureLazyTraceLoaded();
  }
}

async function ensureLazyTraceLoaded(): Promise<void> {
  const source = props.lazySource;
  if (!source) return;
  try {
    await lazyTrace.load();
  } catch (error) {
    console.warn('[SubrunTracePanel] 历史子过程加载失败', {
      conversationId: source.conversationId,
      parentToolCallId: source.parentToolCallId,
      error,
    });
  }
}

function retryLazyTrace(): void {
  void ensureLazyTraceLoaded();
}

onMounted(() => {
  if (isBodyVisible.value) void ensureLazyTraceLoaded();
});
</script>
