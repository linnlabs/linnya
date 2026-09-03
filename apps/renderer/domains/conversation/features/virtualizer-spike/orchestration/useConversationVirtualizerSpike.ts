import { computed, nextTick, ref, watch, type ComponentPublicInstance, type Ref } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import {
  VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
  VIRTUALIZER_SPIKE_CARD_SETTLE_FRAMES,
  VIRTUALIZER_SPIKE_INITIAL_COUNT,
  VIRTUALIZER_SPIKE_CONTENT_PADDING_TOP_PX,
  VIRTUALIZER_SPIKE_NETWORK_DELAY_MS,
  VIRTUALIZER_SPIKE_PAGE_SIZE,
  VIRTUALIZER_SPIKE_PINNED_TAIL_COUNT,
  VIRTUALIZER_SPIKE_PRODUCTION_PAGE_SIZE,
  VIRTUALIZER_SPIKE_PRODUCTION_WINDOW_ROWS,
  VIRTUALIZER_SPIKE_SAMPLE_FRAMES,
  VIRTUALIZER_SPIKE_SCROLL_END_THRESHOLD_PX,
  VIRTUALIZER_SPIKE_TIMELINE_ANIMATION_MS,
  type VirtualizerSpikeAdapterCapabilities,
  type VirtualizerSpikeFrameSample,
  type VirtualizerSpikeGateReport,
  type VirtualizerSpikeMessage,
  type VirtualizerSpikeStabilityResult,
} from '../definitions/virtualizerSpike';
import { assessVirtualizerSpikeStability } from '../functions/assessVirtualizerSpikeStability';
import { createVirtualizerSpikeMessages } from '../functions/createVirtualizerSpikeMessages';
import { extractVirtualizerSpikeRange } from '../functions/extractVirtualizerSpikeRange';
import {
  recordVirtualizerSpikeFrames,
  waitForVirtualizerSpikeFrames,
  waitForVirtualizerSpikePaint,
} from '../functions/recordVirtualizerSpikeFrames';
import {
  readVirtualizerSpikeAnchor,
  readVirtualizerSpikeElementTop,
} from '../functions/readVirtualizerSpikeAnchor';
import { createVueVirtualizerScrollBridge } from '../../../shared/virtualization/vueVirtualizerScrollBridge';
import {
  shouldAdjustConversationScrollOnItemSizeChange,
  useConversationPrependRenderTransaction,
} from '../../../ui/conversationView/composables/useTanstackConversationVirtualizer';

const INITIAL_REPORT: VirtualizerSpikeGateReport = {
  status: 'idle',
  prepend: null,
  preserveHistoryOffset: null,
  tailPinning: null,
  pinnedTailRange: null,
  timelineResize: null,
  cardExpansion: null,
  scrollingMeasurement: null,
  initialEnd: null,
  stickyFooterGeometry: null,
  productionWindowChurn: null,
};

const VIRTUALIZER_SPIKE_ROW_GAP_PX = 12;

function waitForNetworkDelay(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, VIRTUALIZER_SPIKE_NETWORK_DELAY_MS));
}

function allCapabilitiesPass(capabilities: VirtualizerSpikeAdapterCapabilities): boolean {
  return Object.values(capabilities).every(Boolean);
}

function createScenarioMessages(
  startSequence: number,
  count: number,
  includeDelayedImages: boolean,
): VirtualizerSpikeMessage[] {
  const scenarioMessages = createVirtualizerSpikeMessages(startSequence, count);
  return includeDelayedImages
    ? scenarioMessages
    : scenarioMessages.map(message => ({ ...message, image: null }));
}

export function useConversationVirtualizerSpike(scrollerRef: Ref<HTMLElement | null>) {
  const messages = ref<VirtualizerSpikeMessage[]>(
    createVirtualizerSpikeMessages(0, VIRTUALIZER_SPIKE_INITIAL_COUNT),
  );
  const isPaging = ref(false);
  const timelineReservePx = ref(0);
  const expandedCardMessageId = ref<string | null>(null);
  const gateReport = ref<VirtualizerSpikeGateReport>(INITIAL_REPORT);
  let firstSequence = 0;
  let nextSequence = VIRTUALIZER_SPIKE_INITIAL_COUNT;
  let automaticGateRunning = false;
  const prependTransaction = useConversationPrependRenderTransaction(
    messages,
    message => message.id,
  );
  const scrollBridge = createVueVirtualizerScrollBridge({
    shouldDeferExplicitScroll: () => prependTransaction.active.value,
    onDeferredExplicitScrollApplied: prependTransaction.complete,
  });

  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(computed(() => ({
    count: messages.value.length,
    getScrollElement: () => scrollerRef.value,
    estimateSize: (index: number) => messages.value[index]?.estimatedSize ?? 120,
    getItemKey: (index: number) => messages.value[index]?.id ?? `missing-${index}`,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: VIRTUALIZER_SPIKE_SCROLL_END_THRESHOLD_PX,
    // sticky footer 是 scroller 内的真实 DOM 几何，不能重复计入虚拟画布 paddingEnd。
    paddingEnd: 0,
    scrollMargin: VIRTUALIZER_SPIKE_CONTENT_PADDING_TOP_PX,
    // 行间距必须进入 virtualizer 的布局模型，不能放在 measured row 的外部 margin。
    gap: VIRTUALIZER_SPIKE_ROW_GAP_PX,
    rangeExtractor: range => extractVirtualizerSpikeRange(range, VIRTUALIZER_SPIKE_PINNED_TAIL_COUNT),
    overscan: 8,
    useAnimationFrameWithResizeObserver: false,
    scrollToFn: scrollBridge.scrollToFn,
    onChange: instance => scrollBridge.flushAfterRender(instance),
  })));
  watch(
    prependTransaction.revision,
    () => scrollBridge.flushAfterRender(virtualizer.value),
    { flush: 'post' },
  );
  const virtualRows = computed(() => virtualizer.value.getVirtualItems().flatMap((virtualItem) => {
    const message = messages.value[virtualItem.index];
    return message ? [{ virtualItem, message }] : [];
  }));
  const totalSize = computed(() => virtualizer.value.getTotalSize());
  const distanceFromEnd = computed(() => virtualizer.value.getDistanceFromEnd());
  const isAtEnd = computed(() => virtualizer.value.isAtEnd(VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX));
  const adapterCapabilities = computed<VirtualizerSpikeAdapterCapabilities>(() => ({
    anchorToEnd: virtualizer.value.options.anchorTo === 'end',
    followOnAppend: virtualizer.value.options.followOnAppend === true,
    scrollEndThreshold:
      virtualizer.value.options.scrollEndThreshold === VIRTUALIZER_SPIKE_SCROLL_END_THRESHOLD_PX,
    scrollToEnd: typeof virtualizer.value.scrollToEnd === 'function',
    isAtEnd: typeof virtualizer.value.isAtEnd === 'function',
    getDistanceFromEnd: typeof virtualizer.value.getDistanceFromEnd === 'function',
  }));

  // 与生产共用同一合同：prepend 写入延后到 DOM patch，尺寸残差仍补偿上方 row。
  virtualizer.value.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => (
    shouldAdjustConversationScrollOnItemSizeChange(
      item,
      instance.scrollOffset,
    )
  );

  const measureElement = (element: Element | ComponentPublicInstance | null): void => {
    if (element instanceof HTMLElement) {
      virtualizer.value.measureElement(element);
    }
  };

  const resetScenario = async (includeDelayedImages: boolean): Promise<void> => {
    firstSequence = 0;
    nextSequence = VIRTUALIZER_SPIKE_INITIAL_COUNT;
    messages.value = createScenarioMessages(
      0,
      VIRTUALIZER_SPIKE_INITIAL_COUNT,
      includeDelayedImages,
    );
    timelineReservePx.value = 0;
    expandedCardMessageId.value = null;
    await nextTick();
    await waitForVirtualizerSpikeFrames(2);
    virtualizer.value.scrollToEnd();
    await waitForVirtualizerSpikeFrames(4);
  };

  const reset = (): Promise<void> => resetScenario(true);

  const applyPrepend = async (): Promise<VirtualizerSpikeStabilityResult> => {
    const scroller = scrollerRef.value;
    if (!scroller) {
      return assessVirtualizerSpikeStability({
        baseline: 0,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }

    isPaging.value = true;
    await waitForNetworkDelay();
    const anchor = readVirtualizerSpikeAnchor(scroller, virtualizer.value);
    if (!scroller || !anchor) {
      isPaging.value = false;
      return assessVirtualizerSpikeStability({
        baseline: 0,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }

    firstSequence -= VIRTUALIZER_SPIKE_PAGE_SIZE;
    messages.value = [
      ...createVirtualizerSpikeMessages(firstSequence, VIRTUALIZER_SPIKE_PAGE_SIZE),
      ...messages.value,
    ];
    const samples = await recordVirtualizerSpikeFrames({
      frameCount: VIRTUALIZER_SPIKE_SAMPLE_FRAMES,
      readValue: () => readVirtualizerSpikeElementTop(scroller, anchor.key),
    });
    isPaging.value = false;
    return assessVirtualizerSpikeStability({
      baseline: anchor.relativeTop,
      thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
      samples,
    });
  };

  const appendMessage = (): void => {
    messages.value = [
      ...messages.value,
      ...createVirtualizerSpikeMessages(nextSequence, 1),
    ];
    nextSequence += 1;
  };

  const runPrependGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    await resetScenario(true);
    virtualizer.value.scrollToIndex(12, { align: 'start' });
    await waitForVirtualizerSpikeFrames(12);
    return applyPrepend();
  };

  const runPreserveHistoryOffsetGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    await resetScenario(false);
    virtualizer.value.scrollToIndex(18, { align: 'start' });
    await waitForVirtualizerSpikeFrames(12);
    const scroller = scrollerRef.value;
    const baseline = scroller?.scrollTop ?? 0;
    appendMessage();
    const samples = await recordVirtualizerSpikeFrames({
      frameCount: 12,
      readValue: () => scrollerRef.value?.scrollTop ?? null,
    });
    return assessVirtualizerSpikeStability({
      baseline,
      thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
      samples,
    });
  };

  const runTailPinningGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    // tail 门禁只允许 streaming 文本改变高度，延迟图片由 prepend 门禁单独覆盖。
    await resetScenario(false);
    const baseline = 0;
    const streamSequence = nextSequence;
    const streamBase = createVirtualizerSpikeMessages(streamSequence, 1)[0];
    if (!streamBase) {
      return assessVirtualizerSpikeStability({
        baseline,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }

    nextSequence += 1;
    messages.value = [
      ...messages.value,
      { ...streamBase, image: null, paragraphs: ['Streaming response started.'] },
    ];

    const samples: VirtualizerSpikeFrameSample[] = [];
    for (let chunk = 0; chunk < 5; chunk += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 80));
      messages.value = messages.value.map(message => (
        message.sequence === streamSequence
          ? {
              ...message,
              paragraphs: [
                ...message.paragraphs,
                `Streaming chunk ${chunk + 1} grows the final measured row.`,
              ],
            }
          : message
      ));
      const chunkSamples = await recordVirtualizerSpikeFrames({
        frameCount: 4,
        readValue: () => virtualizer.value.getDistanceFromEnd(),
      });
      samples.push(...chunkSamples.map((sample, index) => ({
        frame: chunk * 4 + index,
        value: sample.value,
      })));
    }

    return assessVirtualizerSpikeStability({
      baseline,
      thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
      samples,
    });
  };

  const runPinnedTailRangeGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    await resetScenario(false);
    virtualizer.value.scrollToIndex(18, { align: 'start' });
    await waitForVirtualizerSpikeFrames(5);
    const firstPinnedIndex = messages.value.length - VIRTUALIZER_SPIKE_PINNED_TAIL_COUNT;
    const samples = await recordVirtualizerSpikeFrames({
      frameCount: 4,
      readValue: () => {
        let missingCount = 0;
        for (let index = firstPinnedIndex; index < messages.value.length; index += 1) {
          const message = messages.value[index];
          if (!message) continue;
          const selector = `[data-virtualizer-spike-key="${message.id}"]`;
          if (!scrollerRef.value?.querySelector(selector)) missingCount += 1;
        }
        return missingCount;
      },
    });
    return assessVirtualizerSpikeStability({
      baseline: 0,
      thresholdPx: 1,
      samples,
    });
  };

  const animateTimelineReserve = (targetPx: number): Promise<void> => {
    const startPx = timelineReservePx.value;
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const step = (now: number): void => {
        const progress = Math.min((now - startedAt) / VIRTUALIZER_SPIKE_TIMELINE_ANIMATION_MS, 1);
        timelineReservePx.value = startPx + (targetPx - startPx) * progress;
        if (progress < 1) {
          window.requestAnimationFrame(step);
          return;
        }
        resolve();
      };
      window.requestAnimationFrame(step);
    });
  };

  const runTimelineResizeGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    await resetScenario(false);
    virtualizer.value.scrollToIndex(24, { align: 'start' });
    await waitForVirtualizerSpikeFrames(12);
    const scroller = scrollerRef.value;
    const anchor = scroller ? readVirtualizerSpikeAnchor(scroller, virtualizer.value) : null;
    if (!scroller || !anchor) {
      return assessVirtualizerSpikeStability({
        baseline: 0,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }
    const measuredScroller = scroller;

    const animation = animateTimelineReserve(220);
    const samples = await recordVirtualizerSpikeFrames({
      frameCount: 18,
      readValue: () => readVirtualizerSpikeElementTop(measuredScroller, anchor.key),
    });
    await animation;
    return assessVirtualizerSpikeStability({
      baseline: anchor.relativeTop,
      thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
      samples,
    });
  };

  const runCardExpansionGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    await resetScenario(false);
    const cardMessage = messages.value[24];
    if (!cardMessage) {
      return assessVirtualizerSpikeStability({
        baseline: 0,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }

    virtualizer.value.scrollToIndex(24, { align: 'start' });
    await waitForVirtualizerSpikeFrames(12);
    const scroller = scrollerRef.value;
    const baseline = scroller
      ? readVirtualizerSpikeElementTop(scroller, cardMessage.id)
      : null;
    if (!scroller || baseline === null) {
      return assessVirtualizerSpikeStability({
        baseline: 0,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }

    expandedCardMessageId.value = cardMessage.id;
    const samples = await recordVirtualizerSpikeFrames({
      frameCount: VIRTUALIZER_SPIKE_CARD_SETTLE_FRAMES,
      readValue: () => readVirtualizerSpikeElementTop(scroller, cardMessage.id),
    });
    expandedCardMessageId.value = null;
    return assessVirtualizerSpikeStability({
      baseline,
      thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
      samples,
    });
  };

  const runInitialEndGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    firstSequence = 0;
    nextSequence = VIRTUALIZER_SPIKE_INITIAL_COUNT;
    messages.value = [];
    await nextTick();
    await waitForVirtualizerSpikeFrames(2);

    messages.value = createScenarioMessages(0, VIRTUALIZER_SPIKE_INITIAL_COUNT, true);
    await nextTick();

    virtualizer.value.scrollToEnd();
    await waitForVirtualizerSpikeFrames(12);
    const distanceFromEnd = Math.max(virtualizer.value.getDistanceFromEnd(), 0);

    return assessVirtualizerSpikeStability({
      baseline: 0,
      thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
      samples: [{ frame: 0, value: distanceFromEnd }],
    });
  };

  const runStickyFooterGeometryGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    await resetScenario(false);
    const scroller = scrollerRef.value;
    const content = scroller?.querySelector<HTMLElement>('[data-virtualizer-spike-content]');
    const canvas = scroller?.querySelector<HTMLElement>('[data-virtualizer-spike-canvas]');
    const footer = scroller?.querySelector<HTMLElement>('[data-virtualizer-spike-footer]');
    if (!scroller || !content || !canvas || !footer) {
      return assessVirtualizerSpikeStability({
        baseline: 0,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const canvasOffsetFromScrollOrigin =
      canvas.getBoundingClientRect().top - scrollerRect.top + scroller.scrollTop;
    const footerContribution = scroller.scrollHeight - content.offsetHeight;
    const geometrySamples: VirtualizerSpikeFrameSample[] = [
      {
        frame: 0,
        value: Math.abs(
          canvasOffsetFromScrollOrigin - virtualizer.value.options.scrollMargin,
        ),
      },
      {
        frame: 1,
        // sticky 元素仍在正常流中；这里只允许它以自身高度贡献一次 scroll range。
        value: Math.abs(footerContribution - footer.getBoundingClientRect().height),
      },
    ];

    virtualizer.value.scrollToEnd();
    await waitForVirtualizerSpikeFrames(8);
    const endSamples = await recordVirtualizerSpikeFrames({
      frameCount: 8,
      readValue: () => virtualizer.value.getDistanceFromEnd(),
    });
    return assessVirtualizerSpikeStability({
      baseline: 0,
      thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
      samples: [
        ...geometrySamples,
        ...endSamples.map(sample => ({
          frame: sample.frame + geometrySamples.length,
          value: sample.value,
        })),
      ],
    });
  };

  const runScrollingMeasurementGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    await resetScenario(false);
    virtualizer.value.scrollToIndex(12, { align: 'start' });
    await waitForVirtualizerSpikeFrames(12);
    await applyPrepend();

    const scroller = scrollerRef.value;
    if (!scroller) {
      return assessVirtualizerSpikeStability({
        baseline: 0,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }

    const anchorIndex = virtualizer.value.getVirtualItemForOffset(scroller.scrollTop)?.index;
    const growthMessage = typeof anchorIndex === 'number'
      ? messages.value[Math.max(anchorIndex - 1, 0)]
      : undefined;
    if (!growthMessage) {
      return assessVirtualizerSpikeStability({
        baseline: 0,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }

    let intendedScrollTop = scroller.scrollTop;
    const samples: VirtualizerSpikeFrameSample[] = [];
    for (let frame = 0; frame < 14; frame += 1) {
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }));
      intendedScrollTop = Math.max(intendedScrollTop - 10, 0);
      scroller.scrollTop = intendedScrollTop;
      scroller.dispatchEvent(new Event('scroll'));
      if (frame === 1) expandedCardMessageId.value = growthMessage.id;

      await waitForVirtualizerSpikePaint();
      const correctionDrift = Math.abs(scroller.scrollTop - intendedScrollTop);
      samples.push({
        frame,
        // backward scroll 的成熟策略是避免程序化写入与手势拉扯；上方已测行的自然收敛不要求锚点为 0 漂移。
        value: correctionDrift,
      });
    }
    expandedCardMessageId.value = null;

    return assessVirtualizerSpikeStability({
      baseline: 0,
      thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
      samples,
    });
  };

  const runProductionWindowChurnGate = async (): Promise<VirtualizerSpikeStabilityResult> => {
    firstSequence = 0;
    nextSequence = VIRTUALIZER_SPIKE_PRODUCTION_WINDOW_ROWS;
    messages.value = createScenarioMessages(0, VIRTUALIZER_SPIKE_PRODUCTION_WINDOW_ROWS, false);
    await nextTick();
    await waitForVirtualizerSpikeFrames(4);
    virtualizer.value.scrollToIndex(120, { align: 'start' });
    await waitForVirtualizerSpikeFrames(12);

    const scroller = scrollerRef.value;
    const anchor = scroller ? readVirtualizerSpikeAnchor(scroller, virtualizer.value) : null;
    if (!scroller || !anchor) {
      return assessVirtualizerSpikeStability({
        baseline: 0,
        thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
        samples: [{ frame: 0, value: null }],
      });
    }

    const older = createScenarioMessages(
      -VIRTUALIZER_SPIKE_PRODUCTION_PAGE_SIZE,
      VIRTUALIZER_SPIKE_PRODUCTION_PAGE_SIZE,
      false,
    );
    messages.value = [...older, ...messages.value].slice(0, VIRTUALIZER_SPIKE_PRODUCTION_WINDOW_ROWS);
    const samples = await recordVirtualizerSpikeFrames({
      frameCount: VIRTUALIZER_SPIKE_SAMPLE_FRAMES,
      readValue: () => readVirtualizerSpikeElementTop(scroller, anchor.key),
    });
    return assessVirtualizerSpikeStability({
      baseline: anchor.relativeTop,
      thresholdPx: VIRTUALIZER_SPIKE_ANCHOR_THRESHOLD_PX,
      samples,
    });
  };

  const runAllGates = async (): Promise<void> => {
    if (automaticGateRunning) return;
    automaticGateRunning = true;
    gateReport.value = { ...INITIAL_REPORT, status: 'running' };
    try {
      const prepend = await runPrependGate();
      const preserveHistoryOffset = await runPreserveHistoryOffsetGate();
      const tailPinning = await runTailPinningGate();
      const pinnedTailRange = await runPinnedTailRangeGate();
      const timelineResize = await runTimelineResizeGate();
      const cardExpansion = await runCardExpansionGate();
      const scrollingMeasurement = await runScrollingMeasurementGate();
      const initialEnd = await runInitialEndGate();
      const stickyFooterGeometry = await runStickyFooterGeometryGate();
      const productionWindowChurn = await runProductionWindowChurnGate();
      const passed =
        allCapabilitiesPass(adapterCapabilities.value)
        && prepend.passed
        && preserveHistoryOffset.passed
        && tailPinning.passed
        && pinnedTailRange.passed
        && timelineResize.passed
        && cardExpansion.passed
        && scrollingMeasurement.passed
        && initialEnd.passed
        && stickyFooterGeometry.passed
        && productionWindowChurn.passed;
      gateReport.value = {
        status: passed ? 'passed' : 'failed',
        prepend,
        preserveHistoryOffset,
        tailPinning,
        pinnedTailRange,
        timelineResize,
        cardExpansion,
        scrollingMeasurement,
        initialEnd,
        stickyFooterGeometry,
        productionWindowChurn,
      };
    } finally {
      automaticGateRunning = false;
    }
  };

  const handleScroll = (): void => {
    const scroller = scrollerRef.value;
    if (!scroller || automaticGateRunning || isPaging.value || scroller.scrollTop >= 160) return;
    // 手工滚动期间 anchor top 会随用户输入自然变化，不能覆盖无人为输入的正式门禁报告。
    void applyPrepend();
  };

  return {
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
    scrollToEnd: () => virtualizer.value.scrollToEnd(),
  };
}
