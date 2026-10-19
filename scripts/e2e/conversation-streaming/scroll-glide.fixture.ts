import { computed, createApp, h, nextTick, ref, shallowRef } from 'vue';
import { ConversationVisualTurnIdSchema } from '@app/schemas';
import { createTestAnswerMessage } from '../../../apps/renderer/domains/conversation/testing/functions/createConversationTestMessage';
import type { ConversationVisualRow } from '../../../apps/renderer/domains/conversation/ui/messageCanvas/definitions/conversationVisualRow';
import { useStreamingScrollGlide } from '../../../apps/renderer/domains/conversation/ui/conversationView/composables/useStreamingScrollGlide';
import { useConversationVirtualizerGeometry } from '../../../apps/renderer/domains/conversation/ui/conversationView/composables/useConversationVirtualizerGeometry';
import { useTanstackConversationVirtualizer } from '../../../apps/renderer/domains/conversation/ui/conversationView/composables/useTanstackConversationVirtualizer';
import '../../../apps/renderer/domains/conversation/styles/components/ConversationView.css';

const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runScenario(footerHeight: number) {
  const root = document.createElement('div');
  document.body.append(root);
  const scroll = ref<HTMLElement>();
  const conversation = ref<HTMLElement>();
  const content = ref<HTMLElement | null>(null);
  const inner = ref<HTMLElement | null>(null);
  const height = ref(800);
  const streaming = ref(true);
  const active = ref(true);
  const visualTurnId = ConversationVisualTurnIdSchema.parse('visual_turn_scroll_glide');
  const items = shallowRef<ConversationVisualRow[]>([{
    key: 'scroll-glide', kind: 'message', estimatedHeight: 800, visualTurnId,
    turnContext: { id: visualTurnId, userMessageId: null, sourceMessageIds: ['scroll-glide'] },
    isTurnStart: true, isTurnEnd: true, role: 'assistant', bounded: false,
    payload: createTestAnswerMessage({ id: 'scroll-glide' }),
  }]);
  let sample = () => {};
  let compensatedCommits = 0;
  const app = createApp({
    setup() {
      const geometry = useConversationVirtualizerGeometry({
        conversationRef: conversation, listStartRef: content, scrollElementRef: scroll,
        resetKey: computed(() => 'scroll-glide'),
      });
      const glide = useStreamingScrollGlide({
        scrollElement: scroll, contentElement: inner,
        isActive: () => active.value, isStreaming: () => streaming.value,
        isUserGestureActive: () => false,
      });
      const virtualizer = useTanstackConversationVirtualizer({
        items, enabled: computed(() => true), isStreaming: computed(() => streaming.value),
        scrollMode: computed(() => active.value ? 'follow-bottom' : 'anchored'),
        scrollElement: scroll, scrollMargin: computed(() => geometry.scrollMargin.value),
        scrollEndThreshold: computed(() => geometry.scrollEndThreshold.value), estimationWidthPx: ref(600),
        onScrollApplied: (delta, isSizeAdjustment) => {
          glide.onScrollApplied(delta, isSizeAdjustment);
          if (isSizeAdjustment && delta > 0 && inner.value
            && new DOMMatrix(getComputedStyle(inner.value).transform).m42 > 0) compensatedCommits += 1;
          // 必须在提交处和 rAF 两处取样；只采 rAF 会漏掉上一帧先跳再被 scroll 拉回的错误。
          sample();
        },
      });
      controls = { geometry, virtualizer };
      return () => h('div', { class: 'conversation-view-wrapper' }, [
        h('div', { ref: scroll, style: 'height:400px;width:600px;overflow:auto;overflow-anchor:none;position:relative' }, [
          h('div', { ref: conversation, style: 'padding-top:10px;padding-bottom:24px' }, [
            h('div', { ref: content, class: 'messages-container' }, [
              h('div', { ref: inner }, [
                h('div', { style: { height: `${virtualizer.totalHeight.value}px`, position: 'relative' } },
                  virtualizer.visibleItems.value.map(entry => h('div', {
                    'data-index': entry.index, ref: virtualizer.measureElement,
                    style: {
                      position: 'absolute', top: 0, width: '100%', height: `${height.value}px`,
                      transform: `translateY(${entry.virtualItem.start - geometry.scrollMargin.value}px)`,
                    },
                  }, 'Stable reading anchor'))),
              ]),
            ]),
          ]),
          h('div', { class: 'panel-footer', style: `height:${footerHeight}px;position:sticky;bottom:0` }),
        ]),
      ]);
    },
  });
  let controls: {
    geometry: ReturnType<typeof useConversationVirtualizerGeometry>;
    virtualizer: ReturnType<typeof useTanstackConversationVirtualizer>;
  } | undefined;
  let animationFrame = 0;
  try {
    app.mount(root);
    await wait(150);
    assert(controls !== undefined, 'Fixture did not mount');
    controls.virtualizer.scrollToEnd();
    await wait(400);
    const viewport = scroll.value;
    const layer = inner.value;
    const anchor = content.value?.querySelector('[data-index]');
    assert(viewport !== undefined && layer !== null && anchor !== null && anchor !== undefined, 'Missing fixture DOM');
    const geometry = controls.geometry;
    const originalMargin = geometry.scrollMargin.value;
    const samples: Array<{ top: number; margin: number; scrollHeight: number; logicalHeight: number }> = [];
    sample = () => samples.push({
      top: anchor.getBoundingClientRect().top,
      margin: geometry.scrollMargin.value,
      scrollHeight: viewport.scrollHeight,
      logicalHeight: height.value + 34 + footerHeight,
    });
    const recordFrame = () => {
      sample();
      animationFrame = requestAnimationFrame(recordFrame);
    };
    animationFrame = requestAnimationFrame(recordFrame);
    sample();
    for (let index = 0; index < 40; index += 1) {
      height.value += 28;
      await nextTick();
      geometry.updateGeometry();
      await wait(50);
    }
    streaming.value = false;
    await wait(500);
    cancelAnimationFrame(animationFrame);
    sample = () => {};
    const reversals = samples.slice(1).filter((entry, index) => entry.top > samples[index]!.top + 1).length;
    assert(compensatedCommits >= 40, 'Streaming growth was not visually compensated');
    assert(reversals === 0, `Reading anchor reversed ${reversals} times`);
    assert(samples.every(entry => Math.abs(entry.margin - originalMargin) < 0.1), 'Animation polluted scrollMargin');
    assert(samples.every(entry => entry.scrollHeight <= entry.logicalHeight + 1), 'Animation expanded scrollHeight');
    assert(layer.style.transform === '', 'Terminal left an animation transform');
    assert(Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) <= 1, 'Lost bottom following');

    // 收缩、主动滚动和卸载属于结构变化，不能继承流式补偿。
    streaming.value = true;
    height.value -= 100;
    await wait(80);
    assert(new DOMMatrix(getComputedStyle(layer).transform).m42 === 0, 'Collapse was animated as growth');
    height.value += 28;
    await wait(30);
    active.value = false;
    viewport.scrollTop -= 60;
    await wait(50);
    assert(layer.style.transform === '', 'User scrolling retained animation');
    return { footerHeight, samples: samples.length, reversals, scrollMargin: originalMargin };
  } finally {
    cancelAnimationFrame(animationFrame);
    sample = () => {};
    app.unmount();
    root.remove();
  }
}

// DOM 属性作为隔离进程的结果通道，不向正式 Renderer 注入调试全局。
void (async () => {
  try {
    const results = [await runScenario(120), await runScenario(0)];
    document.body.dataset.result = JSON.stringify({ passed: true, results });
  } catch (error) {
    document.body.dataset.result = JSON.stringify({ passed: false, error: error instanceof Error ? error.stack : String(error) });
  }
})();
