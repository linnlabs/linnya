import { computed, nextTick, ref, shallowRef, type ComponentPublicInstance, type Ref } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { BaseMessage } from '../../../types';
import { projectConversationVisualRows } from '../../../ui/conversationView/logic/projectConversationVisualRows';
import type { ConversationVisualRow } from '../../../ui/messageCanvas';
import { extractRenderedAnswerHtml } from '../../../ui/tools/knowledge/clipboard/richClipboardActions';
import { projectConversationCitationsToEditorHtml } from '../../citation-presentation';
import type { RenderedAnswerTransferPort } from '../../../ui/tools/knowledge/clipboard/definitions/renderedAnswerTransfer';
import type { RenderedAnswerHostExposed } from '../../../ui/tools/knowledge/clipboard/orchestration/useRenderedAnswerTransferHost';
import { resolveTurnFinalAnswers } from '../../../functions/resolveTerminalFinalAnswer';
import type {
  VisualRowFixtureGateReport,
  VisualRowFixtureGateResult,
} from '../definitions/visualRowFixture';
import { createConversationVisualRowFixtureMessages } from '../functions/createConversationVisualRowFixtureMessages';
import { waitForVirtualizerSpikeFrame, waitForVirtualizerSpikeFrames } from '../functions/recordVirtualizerSpikeFrames';
import { createVueVirtualizerScrollBridge } from '../../../shared/virtualization/vueVirtualizerScrollBridge';

interface ConversationVisualRowFixtureTransferHost {
  readonly baselineAnswerHostRef: Ref<RenderedAnswerHostExposed | null>;
  readonly renderedAnswerTransferPort: RenderedAnswerTransferPort;
}

function normalizeRenderedHtml(html: string): string {
  return html.replace(/\s+/g, ' ').trim();
}

export function useConversationVisualRowFixture(
  scrollerRef: Ref<HTMLElement | null>,
  transferHost: ConversationVisualRowFixtureTransferHost,
) {
  const messages = shallowRef<readonly BaseMessage[]>(createConversationVisualRowFixtureMessages());
  const gateReport = ref<VisualRowFixtureGateReport>({ status: 'idle', results: [] });
  // TanStack 会在元素 ref 更新时同步测量。这里不能直接改模板依赖的响应式状态，
  // 否则会形成“测量 -> 重渲染 -> ref 重绑 -> 再测量”的递归更新。
  let measurementCount = 0;
  const measurementSnapshot = ref(0);
  const lastTransfer = ref('none');
  const lastInteraction = ref('none');
  const rows = computed(() => projectConversationVisualRows(messages.value, { widthPx: 680 }));
  const transferActionRow = computed(() => rows.value.find(
    row => row.payload.id === 'visual-answer-1-terminal',
  ) ?? null);
  const transferBaselineAnswers = computed(() => {
    const sourceIds = new Set(transferActionRow.value?.turnContext.sourceMessageIds ?? []);
    return resolveTurnFinalAnswers(messages.value.filter(message => sourceIds.has(message.id)));
  });
  const scrollBridge = createVueVirtualizerScrollBridge();

  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollerRef.value,
    estimateSize: (index: number) => rows.value[index]?.estimatedHeight ?? 80,
    getItemKey: (index: number) => rows.value[index]?.key ?? `visual-row-missing-${index}`,
    anchorTo: 'end',
    followOnAppend: false,
    overscan: 3,
    useAnimationFrameWithResizeObserver: false,
    measureElement: (element, entry) => {
      measurementCount += 1;
      const borderBox = entry?.borderBoxSize?.[0];
      return borderBox?.blockSize ?? element.getBoundingClientRect().height;
    },
    scrollToFn: scrollBridge.scrollToFn,
    onChange: instance => scrollBridge.flushAfterRender(instance),
  })));

  const virtualRows = computed(() => virtualizer.value.getVirtualItems().flatMap((virtualItem) => {
    const row = rows.value[virtualItem.index];
    return row ? [{ row, virtualItem }] : [];
  }));
  const totalSize = computed(() => virtualizer.value.getTotalSize());
  const timelinePositions = computed(() => rows.value.flatMap((row, index) => {
    if (!row.isTurnStart) return [];
    const measurement = virtualizer.value.measurementsCache[index];
    return measurement ? [{ visualTurnId: row.visualTurnId, top: measurement.start }] : [];
  }));

  const measureElement = (element: Element | ComponentPublicInstance | null): void => {
    if (element instanceof HTMLElement) virtualizer.value.measureElement(element);
  };

  const readTurnAnswers = (row: ConversationVisualRow): BaseMessage[] => {
    const sourceIds = new Set(row.turnContext.sourceMessageIds);
    return resolveTurnFinalAnswers(messages.value.filter(message => sourceIds.has(message.id)));
  };

  const buildRenderedTransfer = async (row: ConversationVisualRow, kind: 'copy' | 'save') => {
    const scroller = scrollerRef.value;
    const rowElement = Array.from(
      scroller?.querySelectorAll<HTMLElement>('[data-visual-row-key]') ?? [],
    ).find(element => element.dataset.visualRowKey === row.key) ?? null;
    const answers = readTurnAnswers(row);
    const renderedHtml = await transferHost.renderedAnswerTransferPort.withRenderedAnswers(
      { answers },
      session => extractRenderedAnswerHtml({
        containerEl: session.containerEl,
        copyScope: 'turn-answer',
        answerMessageIds: session.answerMessageIds,
      }),
    );
    lastTransfer.value = `${kind}: ${row.payload.id}`;
    return { renderedHtml, rowElement };
  };

  const copyTurn = async (row: ConversationVisualRow): Promise<void> => {
    await buildRenderedTransfer(row, 'copy');
    await navigator.clipboard.writeText(readTurnAnswers(row).map(answer => answer.content).join('\n\n'));
  };
  const saveTurn = async (row: ConversationVisualRow): Promise<void> => {
    await buildRenderedTransfer(row, 'save');
  };
  const recordInteraction = (kind: string, row: ConversationVisualRow): void => {
    lastInteraction.value = `${kind}: ${row.payload.id} @ ${row.visualTurnId}`;
  };

  const runGates = async (): Promise<void> => {
    gateReport.value = { status: 'running', results: [] };
    const results: VisualRowFixtureGateResult[] = [];
    await nextTick();
    await waitForVirtualizerSpikeFrames(4);
    virtualizer.value.scrollToEnd();
    await waitForVirtualizerSpikeFrames(4);

    const timeline = timelinePositions.value;
    results.push({
      label: 'timeline anchors',
      passed: timeline.length === 3 && timeline.every((position, index) => (
        index === 0 || position.top > (timeline[index - 1]?.top ?? -1)
      )),
      detail: `${timeline.length} ordered turn starts`,
    });

    const firstAnswerIndex = rows.value.findIndex(row => row.payload.id === 'visual-answer-1-terminal');
    if (firstAnswerIndex >= 0) {
      virtualizer.value.scrollToIndex(firstAnswerIndex, { align: 'center' });
    }
    await waitForVirtualizerSpikeFrames(4);
    const firstAnswerRow = rows.value[firstAnswerIndex];
    const scroller = scrollerRef.value;
    const transfer = firstAnswerRow ? await buildRenderedTransfer(firstAnswerRow, 'copy') : null;
    const answerActionsMounted = !!transfer?.rowElement?.querySelector('.conversation-answer-actions');
    const baselineContainer = transferHost.baselineAnswerHostRef.value?.rootElement ?? null;
    const answerIds = transferBaselineAnswers.value.map(answer => answer.id);
    const baselineHtml = extractRenderedAnswerHtml({
      containerEl: baselineContainer,
      copyScope: 'turn-answer',
      answerMessageIds: answerIds,
    });
    const citation = {
      ref: 'ab1234',
      index: 1,
      sourceType: 'knowledge_base' as const,
      docId: 'fixture-doc',
      blockId: 'fixture-block',
      docTitle: 'Fixture citation',
      snippet: 'Fixture citation snippet',
    };
    const hydrate = (html: string) => projectConversationCitationsToEditorHtml({
      renderedHtml: html,
      findCitationByRef: (_turnId, ref) => ref === citation.ref ? citation : null,
      generateCitationId: () => 'fixture-citation-id',
    });
    const baselineHydrated = hydrate(baselineHtml);
    const onDemandHydrated = hydrate(transfer?.renderedHtml ?? '');
    const normalizedBaseline = normalizeRenderedHtml(baselineHydrated.html);
    const normalizedOnDemand = normalizeRenderedHtml(onDemandHydrated.html);
    const codeIsRendered = baselineContainer?.querySelector('.smart-code-block code')?.textContent
      ?.includes('const stable = true') === true;
    const answerOrderPreserved = normalizedOnDemand.indexOf('Evidence')
      < normalizedOnDemand.indexOf('Transfer');
    const hydrationStatsMatch = JSON.stringify(baselineHydrated.stats)
      === JSON.stringify(onDemandHydrated.stats);
    results.push({
      label: 'on-demand rendered copy/export',
      passed: !!transfer?.rowElement
        && answerActionsMounted
        && normalizedBaseline === normalizedOnDemand
        && hydrationStatsMatch
        && codeIsRendered
        && answerOrderPreserved
        && answerIds.length === 2,
      detail: `${answerIds.length} answers, ${hydrationStatsMatch ? 'hydration equal' : 'hydration mismatch'}, ${codeIsRendered ? 'code rendered' : 'code empty'}`,
    });

    const editRow = rows.value.find(row => row.payload.id === 'visual-user-2');
    results.push({
      label: 'edit context',
      passed: editRow?.turnContext.userMessageId === 'visual-user-2'
        && editRow.turnContext.sourceMessageIds.includes('visual-card-answer'),
      detail: editRow ? `${editRow.payload.id} @ ${editRow.visualTurnId}` : 'missing row',
    });

    const webSearchRowIndex = rows.value.findIndex(
      row => row.payload.id === 'visual-card-web-search',
    );
    if (webSearchRowIndex >= 0) {
      virtualizer.value.scrollToIndex(webSearchRowIndex, { align: 'center' });
      await waitForVirtualizerSpikeFrames(4);
    }
    const webSearchRowElement = scroller?.querySelector<HTMLElement>(
      '[data-visual-row-key="msg_visual-card-web-search"]',
    ) ?? null;
    const webSearchToolCard = webSearchRowElement?.querySelector<HTMLElement>(
      '.tool-calls-message',
    ) ?? null;
    if (webSearchToolCard?.classList.contains('is-collapsed')) {
      webSearchToolCard.querySelector<HTMLElement>('.tool-card__header')?.click();
      await waitForVirtualizerSpikeFrames(4);
    }
    const webSearchContentColumn = webSearchRowElement?.querySelector<HTMLElement>(
      '.visual-row-fixture-row__content-inner',
    ) ?? null;
    const webSearchCard = webSearchRowElement?.querySelector<HTMLElement>('.web-search-card') ?? null;
    const contentColumnRect = webSearchContentColumn?.getBoundingClientRect();
    const webSearchCardRect = webSearchCard?.getBoundingClientRect();
    const containmentTolerancePx = 0.5;
    const isWebSearchContained = !!contentColumnRect
      && !!webSearchCardRect
      && webSearchCardRect.left >= contentColumnRect.left - containmentTolerancePx
      && webSearchCardRect.right <= contentColumnRect.right + containmentTolerancePx
      && (webSearchContentColumn?.scrollWidth ?? 1) <= (webSearchContentColumn?.clientWidth ?? 0);
    results.push({
      label: 'web search column containment',
      passed: isWebSearchContained,
      detail: contentColumnRect && webSearchCardRect
        ? `column ${contentColumnRect.width}px / card ${webSearchCardRect.width}px / scroll ${webSearchContentColumn?.scrollWidth ?? 0}px`
        : 'web search card missing',
    });

    let subagentHeader: HTMLElement | null = null;
    for (let frame = 0; frame < 30 && !subagentHeader; frame += 1) {
      await waitForVirtualizerSpikeFrame();
      subagentHeader = scroller?.querySelector<HTMLElement>('.deep-trace__header') ?? null;
    }
    const subagentMeasurementsBefore = measurementCount;
    subagentHeader?.click();
    await waitForVirtualizerSpikeFrames(4);
    const subagentBody = scroller?.querySelector<HTMLElement>('.deep-trace__body') ?? null;
    results.push({
      label: 'subagent lazy expansion',
      passed: !!subagentHeader
        && !!subagentBody
        && subagentBody.style.display !== 'none'
        && measurementCount > subagentMeasurementsBefore,
      detail: `${subagentHeader ? 'header found' : 'header missing'}, ${measurementCount - subagentMeasurementsBefore} measurements`,
    });

    measurementSnapshot.value = measurementCount;
    gateReport.value = {
      status: results.every(result => result.passed) ? 'passed' : 'failed',
      results,
    };
  };

  return {
    gateReport,
    lastInteraction,
    lastTransfer,
    measureElement,
    measurementSnapshot,
    messages,
    rows,
    runGates,
    saveTurn,
    copyTurn,
    recordInteraction,
    timelinePositions,
    totalSize,
    transferBaselineAnswers,
    virtualRows,
  };
}
