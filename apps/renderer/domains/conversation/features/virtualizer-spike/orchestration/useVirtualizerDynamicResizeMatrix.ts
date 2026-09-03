import { computed, nextTick, ref, type ComponentPublicInstance, type Ref } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import {
  VIRTUALIZER_DYNAMIC_MATRIX_ANCHOR_THRESHOLD_PX,
  VIRTUALIZER_DYNAMIC_MATRIX_SAMPLE_FRAMES,
  type VirtualizerDynamicFixtureRow,
  type VirtualizerDynamicGranularity,
  type VirtualizerDynamicMatrixCaseResult,
  type VirtualizerDynamicMatrixReport,
  type VirtualizerDynamicPolicy,
  type VirtualizerDynamicScenario,
} from '../definitions/dynamicResizeMatrix';
import { assessVirtualizerSpikeStability } from '../functions/assessVirtualizerSpikeStability';
import {
  assessVirtualizerDynamicMatrixCase,
  readVirtualizerDynamicExpectation,
} from '../functions/assessVirtualizerDynamicMatrixCase';
import {
  createVirtualizerDynamicScenario,
  mutateVirtualizerDynamicScenario,
  prependVirtualizerDynamicRows,
} from '../functions/createVirtualizerDynamicScenario';
import {
  recordVirtualizerSpikeFrames,
  waitForVirtualizerSpikeFrame,
  waitForVirtualizerSpikeFrames,
  waitForVirtualizerSpikePaint,
} from '../functions/recordVirtualizerSpikeFrames';
import { createVueVirtualizerScrollBridge } from '../../../shared/virtualization/vueVirtualizerScrollBridge';

const MATRIX_SCROLL_MARGIN_PX = 10;
const MATRIX_ROW_GAP_PX = 12;
// 后继稳定 row 从视口顶开始，确保它前面的独立动态 row 连同 gap 完整离开视口。
// turn 赛道的动态块仍与锚点同属一个跨视口根 item，不会因此误命中谓词。
const MATRIX_ANCHOR_TOP_PX = 0;
const MATRIX_BACKWARD_NUDGE_PX = 36;
const BASE_SCENARIOS: readonly VirtualizerDynamicScenario[] = [
  'image-growth',
  'chart-growth',
  'bash-growth',
];
const SUPPLEMENTAL_SCENARIOS: readonly VirtualizerDynamicScenario[] = [
  'chart-shrink',
  'batch-resize',
  'prepend-resize',
];
const BOUNDED_SCENARIOS: readonly VirtualizerDynamicScenario[] = ['bounded-nested-growth'];
const GRANULARITIES: readonly VirtualizerDynamicGranularity[] = ['turn', 'visual-row'];
const POLICIES: readonly VirtualizerDynamicPolicy[] = ['default', 'fully-above'];

interface MatrixCaseSpec {
  readonly policy: VirtualizerDynamicPolicy;
  readonly granularity: VirtualizerDynamicGranularity;
  readonly scenario: VirtualizerDynamicScenario;
}

function createMatrixCaseSpecs(): MatrixCaseSpec[] {
  const base = POLICIES.flatMap(policy => GRANULARITIES.flatMap(granularity => (
    BASE_SCENARIOS.map(scenario => ({ policy, granularity, scenario }))
  )));
  const supplemental = GRANULARITIES.flatMap(granularity => (
    SUPPLEMENTAL_SCENARIOS.map(scenario => ({
      policy: 'fully-above' as const,
      granularity,
      scenario,
    }))
  ));
  const bounded = POLICIES.flatMap(policy => GRANULARITIES.flatMap(granularity => (
    BOUNDED_SCENARIOS.map(scenario => ({ policy, granularity, scenario }))
  )));
  return [...base, ...supplemental, ...bounded];
}

function readAnchorTop(scroller: HTMLElement, anchorKey: string): number | null {
  const anchors = scroller.querySelectorAll<HTMLElement>('[data-virtualizer-dynamic-anchor]');
  for (const anchor of anchors) {
    if (anchor.dataset.virtualizerDynamicAnchor === anchorKey) {
      return anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    }
  }
  return null;
}

export function useVirtualizerDynamicResizeMatrix(scrollerRef: Ref<HTMLElement | null>) {
  const rows = ref<readonly VirtualizerDynamicFixtureRow[]>([]);
  const report = ref<VirtualizerDynamicMatrixReport>({ status: 'idle', cases: [] });
  const scrollBridge = createVueVirtualizerScrollBridge();
  let running = false;
  let runSequence = 0;
  let predicateCalls = 0;
  let predicateMatches = 0;

  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollerRef.value,
    estimateSize: (index: number) => rows.value[index]?.estimatedSize ?? 96,
    getItemKey: (index: number) => rows.value[index]?.id ?? `dynamic-missing-${index}`,
    anchorTo: 'end',
    followOnAppend: false,
    scrollEndThreshold: 1,
    scrollMargin: MATRIX_SCROLL_MARGIN_PX,
    gap: MATRIX_ROW_GAP_PX,
    overscan: rows.value.length,
    rangeExtractor: range => Array.from({ length: range.count }, (_, index) => index),
    useAnimationFrameWithResizeObserver: false,
    scrollToFn: scrollBridge.scrollToFn,
    onChange: instance => scrollBridge.flushAfterRender(instance),
  })));

  const virtualRows = computed(() => virtualizer.value.getVirtualItems().flatMap((virtualItem) => {
    const row = rows.value[virtualItem.index];
    return row ? [{ row, virtualItem }] : [];
  }));
  const totalSize = computed(() => virtualizer.value.getTotalSize());

  const measureElement = (element: Element | ComponentPublicInstance | null): void => {
    if (element instanceof HTMLElement) virtualizer.value.measureElement(element);
  };

  const readMeasuredRowSize = (rowKey: string): number | null => {
    const index = rows.value.findIndex(row => row.id === rowKey);
    if (index < 0) return null;
    return virtualizer.value.measurementsCache[index]?.size ?? null;
  };

  const installPolicy = (policy: VirtualizerDynamicPolicy): void => {
    predicateCalls = 0;
    predicateMatches = 0;
    if (policy === 'default') {
      virtualizer.value.shouldAdjustScrollPositionOnItemSizeChange = undefined;
      return;
    }

    // 3.17.3 只读取实例属性；放进 options 会静默失效。
    virtualizer.value.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      predicateCalls += 1;
      const matched = item.end <= (instance.scrollOffset ?? 0);
      if (matched) predicateMatches += 1;
      return matched;
    };
  };

  const positionAnchor = async (anchorKey: string): Promise<number | null> => {
    const scroller = scrollerRef.value;
    if (!scroller) return null;
    await nextTick();
    await waitForVirtualizerSpikeFrames(4);
    const currentTop = readAnchorTop(scroller, anchorKey);
    if (currentTop === null) return null;

    scroller.scrollTop = Math.max(0, scroller.scrollTop + currentTop - MATRIX_ANCHOR_TOP_PX);
    scroller.dispatchEvent(new Event('scroll'));
    await waitForVirtualizerSpikeFrames(2);
    return readAnchorTop(scroller, anchorKey);
  };

  const armBackwardScroll = async (): Promise<boolean> => {
    const scroller = scrollerRef.value;
    if (!scroller) return false;
    const target = scroller.scrollTop;
    scroller.scrollTop = target + MATRIX_BACKWARD_NUDGE_PX;
    scroller.dispatchEvent(new Event('scroll'));
    await waitForVirtualizerSpikeFrame();
    scroller.scrollTop = target;
    scroller.dispatchEvent(new Event('scroll'));
    await waitForVirtualizerSpikeFrame();
    return virtualizer.value.scrollDirection === 'backward';
  };

  const mutateForScenario = async (
    scenario: VirtualizerDynamicScenario,
    runId: string,
  ): Promise<void> => {
    if (scenario === 'prepend-resize') {
      rows.value = prependVirtualizerDynamicRows(rows.value, runId);
      await nextTick();
    }
    rows.value = mutateVirtualizerDynamicScenario(rows.value, scenario, 1);
  };

  const recordScenarioFrames = async (
    scenario: VirtualizerDynamicScenario,
    anchorKey: string,
  ) => {
    const scroller = scrollerRef.value;
    if (!scroller) return [{ frame: 0, value: null }];

    if (scenario !== 'bash-growth') {
      return recordVirtualizerSpikeFrames({
        frameCount: VIRTUALIZER_DYNAMIC_MATRIX_SAMPLE_FRAMES,
        readValue: () => readAnchorTop(scroller, anchorKey),
      });
    }

    const samples = [];
    for (let frame = 0; frame < VIRTUALIZER_DYNAMIC_MATRIX_SAMPLE_FRAMES; frame += 1) {
      if (frame % 2 === 0) {
        rows.value = mutateVirtualizerDynamicScenario(rows.value, scenario, frame / 2 + 1);
      }
      await waitForVirtualizerSpikePaint();
      samples.push({ frame, value: readAnchorTop(scroller, anchorKey) });
    }
    return samples;
  };

  const runCase = async (spec: MatrixCaseSpec): Promise<VirtualizerDynamicMatrixCaseResult> => {
    const runId = `${runSequence}-${spec.policy}-${spec.granularity}-${spec.scenario}`;
    runSequence += 1;
    installPolicy(spec.policy);
    const fixture = createVirtualizerDynamicScenario({
      granularity: spec.granularity,
      runId,
      scenario: spec.scenario,
    });
    rows.value = fixture.rows;
    const baseline = await positionAnchor(fixture.anchorKey);
    const scroller = scrollerRef.value;
    const backwardScrollObserved = await armBackwardScroll();
    const stableBaseline = baseline ?? 0;
    const baselineScrollTop = scroller?.scrollTop ?? 0;
    const baselineOuterHeight = readMeasuredRowSize(fixture.measuredRowKey);

    // 初始化测量也会经过实例谓词；哨兵只统计本场景的动态重测。
    predicateCalls = 0;
    predicateMatches = 0;
    await mutateForScenario(spec.scenario, runId);
    const samples = await recordScenarioFrames(spec.scenario, fixture.anchorKey);
    const stability = assessVirtualizerSpikeStability({
      baseline: stableBaseline,
      samples,
      thresholdPx: VIRTUALIZER_DYNAMIC_MATRIX_ANCHOR_THRESHOLD_PX,
    });
    const scrollCorrectionPx = Math.abs((scroller?.scrollTop ?? baselineScrollTop) - baselineScrollTop);
    const finalOuterHeight = readMeasuredRowSize(fixture.measuredRowKey);
    const outerHeightDeltaPx = baselineOuterHeight === null || finalOuterHeight === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(finalOuterHeight - baselineOuterHeight);
    const expectation = readVirtualizerDynamicExpectation(spec);
    const expectationMet = baseline !== null && assessVirtualizerDynamicMatrixCase({
      expectation,
      granularity: spec.granularity,
      policy: spec.policy,
      predicateCalls,
      predicateMatches,
      backwardScrollObserved,
      scrollCorrectionPx,
      outerHeightDeltaPx,
      scenario: spec.scenario,
      stability,
    });

    return {
      id: runId,
      ...spec,
      expectation,
      stability,
      predicateCalls,
      predicateMatches,
      backwardScrollObserved,
      scrollCorrectionPx,
      outerHeightDeltaPx,
      expectationMet,
    };
  };

  const runMatrix = async (): Promise<void> => {
    if (running) return;
    running = true;
    report.value = { status: 'running', cases: [] };
    try {
      const results: VirtualizerDynamicMatrixCaseResult[] = [];
      for (const spec of createMatrixCaseSpecs()) {
        const result = await runCase(spec);
        results.push(result);
        report.value = { status: 'running', cases: [...results] };
      }
      report.value = {
        status: results.every(result => result.expectationMet) ? 'passed' : 'failed',
        cases: results,
      };
    } finally {
      running = false;
    }
  };

  return {
    report,
    rows,
    virtualRows,
    totalSize,
    measureElement,
    runMatrix,
  };
}
