// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { useStreamingRevealContent, type StreamingRevealEnvironment } from './useStreamingRevealContent';

function createFakeEnvironment() {
  let nowMs = 0;
  let nextHandle = 1;
  let hidden = false;
  const frames = new Map<number, (nowMs: number) => void>();
  const visibilityListeners = new Set<() => void>();
  const environment: StreamingRevealEnvironment = {
    now: () => nowMs,
    requestFrame: callback => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: handle => { frames.delete(handle); },
    isHidden: () => hidden,
    onVisibilityChange: callback => {
      visibilityListeners.add(callback);
      return () => { visibilityListeners.delete(callback); };
    },
  };
  return {
    environment,
    pendingFrames: () => frames.size,
    tick(ms = 16) {
      nowMs += ms;
      const due = [...frames.entries()];
      frames.clear();
      due.forEach(([, callback]) => callback(nowMs));
    },
    setHidden(value: boolean) {
      hidden = value;
      visibilityListeners.forEach(listener => listener());
    },
  };
}

describe('useStreamingRevealContent', () => {
  let app: App<Element> | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
  });

  function setup(initial: { content: string; streaming?: boolean; enabled?: boolean }) {
    const fake = createFakeEnvironment();
    const content = ref(initial.content);
    const streaming = ref(initial.streaming ?? true);
    const enabled = ref(initial.enabled ?? true);
    let revealed!: { value: string };
    const Host = defineComponent({
      setup() {
        revealed = useStreamingRevealContent({
          content: () => content.value,
          isStreaming: () => streaming.value,
          enabled: () => enabled.value,
          environment: fake.environment,
        }).revealedContent;
        return () => h('div');
      },
    });
    app = createApp(Host);
    app.mount(document.createElement('div'));
    return { fake, content, streaming, enabled, revealed: () => revealed.value };
  }

  it('挂载时已有的内容立即等于真实内容', () => {
    const fixture = setup({ content: 'already here' });
    expect(fixture.revealed()).toBe('already here');
    expect(fixture.fake.pendingFrames()).toBe(0);
  });

  it('尾部追加逐帧放出，最终追平真实内容，且始终是真实内容的前缀', async () => {
    const fixture = setup({ content: 'start ' });
    fixture.content.value = 'start ' + 'x'.repeat(60);
    await nextTick();
    expect(fixture.revealed()).toBe('start ');

    let steps = 0;
    while (fixture.revealed() !== fixture.content.value && steps < 100) {
      fixture.fake.tick();
      expect(fixture.content.value.startsWith(fixture.revealed())).toBe(true);
      steps += 1;
    }
    expect(fixture.revealed()).toBe(fixture.content.value);
    expect(steps).toBeGreaterThan(3);
    expect(steps * 16).toBeLessThanOrEqual(250 + 48);
    expect(fixture.fake.pendingFrames()).toBe(0);
  });

  it('流式结束立即放出全部，并停止逐帧调度', async () => {
    const fixture = setup({ content: 'a' });
    fixture.content.value = 'a' + 'b'.repeat(200);
    await nextTick();
    fixture.fake.tick();
    expect(fixture.revealed().length).toBeLessThan(fixture.content.value.length);

    fixture.streaming.value = false;
    await nextTick();
    expect(fixture.revealed()).toBe(fixture.content.value);
    expect(fixture.fake.pendingFrames()).toBe(0);
  });

  it('内容不是尾部追加（被替换）时立即显示', async () => {
    const fixture = setup({ content: 'old content here' });
    fixture.content.value = 'old content here and more';
    await nextTick();
    fixture.content.value = 'replaced';
    await nextTick();
    expect(fixture.revealed()).toBe('replaced');
    expect(fixture.fake.pendingFrames()).toBe(0);
  });

  it('关闭功能时始终等于真实内容', async () => {
    const fixture = setup({ content: 'a', enabled: false });
    fixture.content.value = 'a' + 'b'.repeat(80);
    await nextTick();
    expect(fixture.revealed()).toBe(fixture.content.value);
    expect(fixture.fake.pendingFrames()).toBe(0);
  });

  it('页面不可见：立即放出全部，期间的追加也直接显示', async () => {
    const fixture = setup({ content: 'a' });
    fixture.content.value = 'a' + 'b'.repeat(100);
    await nextTick();
    fixture.fake.setHidden(true);
    expect(fixture.revealed()).toBe(fixture.content.value);

    fixture.content.value += 'more';
    await nextTick();
    expect(fixture.revealed()).toBe(fixture.content.value);
    expect(fixture.fake.pendingFrames()).toBe(0);
  });

  it('不会把代理对（emoji）切成两半', async () => {
    const fixture = setup({ content: '' });
    fixture.content.value = '😀'.repeat(40);
    await nextTick();
    for (let step = 0; step < 40; step += 1) {
      fixture.fake.tick();
      const text = fixture.revealed();
      const last = text.charCodeAt(text.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(fixture.revealed()).toBe(fixture.content.value);
  });
});
