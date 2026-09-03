<template>
  <main class="spike-page">
    <header class="spike-toolbar">
      <div class="spike-toolbar__title">
        <h1>Conversation virtualizer gate</h1>
        <p>TanStack Vue Virtual adapter contract and deterministic chat fixture</p>
      </div>

      <div class="spike-toolbar__actions">
        <button
          type="button"
          :disabled="gateReport.status === 'running'"
          @click="runAllGates"
        >
          Run gates
        </button>
        <button
          type="button"
          :disabled="dynamicMatrixReport.status === 'running'"
          @click="runDynamicMatrix"
        >
          Run B0
        </button>
        <button
          type="button"
          :disabled="isPaging"
          @click="applyPrepend"
        >
          Prepend page
        </button>
        <button
          type="button"
          @click="appendMessage"
        >
          Append message
        </button>
        <button
          type="button"
          @click="scrollToEnd"
        >
          Latest
        </button>
        <button
          type="button"
          @click="reset"
        >
          Reset
        </button>
      </div>
    </header>

    <section
      class="spike-status"
      aria-label="Gate status"
    >
      <div class="spike-status__group">
        <strong>Adapter</strong>
        <span
          v-for="capability in capabilityRows"
          :key="capability.label"
          :class="capability.passed ? 'status-pass' : 'status-fail'"
        >
          {{ capability.label }}: {{ capability.passed ? 'yes' : 'no' }}
        </span>
      </div>

      <div class="spike-status__group">
        <strong>Gates: {{ gateReport.status }}</strong>
        <span
          v-for="gate in gateRows"
          :key="gate.label"
          :class="gate.result?.passed ? 'status-pass' : gate.result ? 'status-fail' : ''"
        >
          {{ gate.label }}:
          {{ gate.result ? `${gate.result.maxDriftPx.toFixed(3)}px drift` : 'not run' }}
        </span>
      </div>

      <div class="spike-status__metrics">
        <span>{{ messages.length }} rows</span>
        <span>{{ isPaging ? 'paging' : 'idle' }}</span>
        <span>{{ isAtEnd ? 'at end' : `${distanceFromEnd.toFixed(1)}px from end` }}</span>
      </div>
    </section>

    <section
      class="dynamic-matrix-report"
      aria-label="Dynamic resize matrix"
    >
      <strong>B0: {{ dynamicMatrixReport.status }}</strong>
      <div class="dynamic-matrix-report__rows">
        <span
          v-for="result in dynamicMatrixReport.cases"
          :key="result.id"
          :class="result.expectationMet ? 'status-pass' : 'status-fail'"
        >
          {{ result.policy }} / {{ result.granularity }} / {{ result.scenario }}:
          {{ result.expectationMet ? 'PASS' : 'FAIL' }}
          drift {{ result.stability.maxDriftPx.toFixed(3) }}px
          (expect {{ result.expectation }}, calls {{ result.predicateCalls }}, matches {{ result.predicateMatches }})
          outer {{ result.outerHeightDeltaPx.toFixed(3) }}px
          back {{ result.backwardScrollObserved ? 'yes' : 'no' }}
          corr {{ result.scrollCorrectionPx.toFixed(3) }}px
          missing {{ result.stability.missingFrames }}
        </span>
      </div>
    </section>

    <div
      ref="scrollerRef"
      class="spike-scroller"
      data-virtualizer-spike-scroller
      @scroll.passive="handleScroll"
    >
      <div
        class="spike-content"
        data-virtualizer-spike-content
        :style="{
          paddingTop: `${contentPaddingTopPx}px`,
          paddingBottom: `${contentPaddingBottomPx}px`,
        }"
      >
        <div
          class="spike-virtual-canvas"
          data-virtualizer-spike-canvas
          :style="{
            height: `${totalSize}px`,
            width: `calc(min(840px, 100%) - ${timelineReservePx}px)`,
          }"
        >
          <div
            v-for="row in virtualRows"
            :key="row.virtualItem.key"
            :ref="measureElement"
            class="spike-virtual-row"
            :data-index="row.virtualItem.index"
            :data-virtualizer-spike-key="String(row.virtualItem.key)"
            :style="{ transform: `translateY(${row.virtualItem.start - contentPaddingTopPx}px)` }"
          >
            <VirtualizerSpikeMessage
              :message="row.message"
              :card-expanded="expandedCardMessageId === row.message.id"
            />
          </div>
        </div>
      </div>
      <div
        class="spike-footer"
        data-virtualizer-spike-footer
        :style="{ height: `${footerHeightPx}px` }"
      >
        <div class="spike-footer__input" />
      </div>
    </div>

    <div
      ref="dynamicScrollerRef"
      class="dynamic-matrix-fixture"
      aria-hidden="true"
    >
      <div
        class="dynamic-matrix-fixture__canvas"
        :style="{ height: `${dynamicTotalSize}px` }"
      >
        <div
          v-for="entry in dynamicVirtualRows"
          :key="entry.virtualItem.key"
          :ref="measureDynamicElement"
          class="dynamic-matrix-fixture__row"
          :data-index="entry.virtualItem.index"
          :style="{ transform: `translateY(${entry.virtualItem.start - dynamicScrollMarginPx}px)` }"
        >
          <VirtualizerDynamicMatrixRow :row="entry.row" />
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConversationVirtualizerSpike } from '../orchestration/useConversationVirtualizerSpike';
import { useVirtualizerDynamicResizeMatrix } from '../orchestration/useVirtualizerDynamicResizeMatrix';
import {
  VIRTUALIZER_SPIKE_CONTENT_PADDING_BOTTOM_PX,
  VIRTUALIZER_SPIKE_CONTENT_PADDING_TOP_PX,
  VIRTUALIZER_SPIKE_FOOTER_HEIGHT_PX,
} from '../definitions/virtualizerSpike';
import VirtualizerSpikeMessage from './VirtualizerSpikeMessage.vue';
import VirtualizerDynamicMatrixRow from './VirtualizerDynamicMatrixRow.vue';
import '../styles/conversationVirtualizerSpike.css';

const scrollerRef = ref<globalThis.HTMLElement | null>(null);
const dynamicScrollerRef = ref<globalThis.HTMLElement | null>(null);
const {
  messages,
  virtualRows,
  totalSize,
  distanceFromEnd,
  isAtEnd,
  isPaging,
  timelineReservePx,
  expandedCardMessageId,
  gateReport,
  adapterCapabilities,
  measureElement,
  handleScroll,
  reset,
  applyPrepend,
  appendMessage,
  runAllGates,
  scrollToEnd,
} = useConversationVirtualizerSpike(scrollerRef);

const {
  report: dynamicMatrixReport,
  virtualRows: dynamicVirtualRows,
  totalSize: dynamicTotalSize,
  measureElement: measureDynamicElement,
  runMatrix: runDynamicMatrix,
} = useVirtualizerDynamicResizeMatrix(dynamicScrollerRef);

const capabilityRows = computed(() => [
  { label: 'anchorTo=end', passed: adapterCapabilities.value.anchorToEnd },
  { label: 'followOnAppend', passed: adapterCapabilities.value.followOnAppend },
  { label: 'scrollEndThreshold', passed: adapterCapabilities.value.scrollEndThreshold },
  { label: 'scrollToEnd()', passed: adapterCapabilities.value.scrollToEnd },
  { label: 'isAtEnd()', passed: adapterCapabilities.value.isAtEnd },
  { label: 'getDistanceFromEnd()', passed: adapterCapabilities.value.getDistanceFromEnd },
]);

const gateRows = computed(() => [
  { label: 'prepend anchor', result: gateReport.value.prepend },
  { label: 'preserve history offset', result: gateReport.value.preserveHistoryOffset },
  { label: 'tail pinning', result: gateReport.value.tailPinning },
  { label: 'pinned tail range', result: gateReport.value.pinnedTailRange },
  { label: 'timeline resize', result: gateReport.value.timelineResize },
  { label: 'card expansion', result: gateReport.value.cardExpansion },
  { label: 'scrolling measurement', result: gateReport.value.scrollingMeasurement },
  { label: 'initial end', result: gateReport.value.initialEnd },
  { label: 'sticky footer geometry', result: gateReport.value.stickyFooterGeometry },
  { label: '320-row window churn', result: gateReport.value.productionWindowChurn },
]);

const contentPaddingTopPx = VIRTUALIZER_SPIKE_CONTENT_PADDING_TOP_PX;
const contentPaddingBottomPx = VIRTUALIZER_SPIKE_CONTENT_PADDING_BOTTOM_PX;
const footerHeightPx = VIRTUALIZER_SPIKE_FOOTER_HEIGHT_PX;
const dynamicScrollMarginPx = 10;

</script>
