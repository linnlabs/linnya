// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import { useStreamingScrollGlide, type StreamingScrollGlideEnvironment } from './useStreamingScrollGlide';

function createFakeEnvironment() {
  let nowMs = 0;
  let nextHandle = 1;
  let reducedMotion = false;
  let pixelRatio = 2;
  let visible = true;
  const frames = new Map<number, (nowMs: number) => void>();
  const environment: StreamingScrollGlideEnvironment = {
    now: () => nowMs,
    requestFrame: callback => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: handle => { frames.delete(handle); },
    prefersReducedMotion: () => reducedMotion,
    devicePixelRatio: () => pixelRatio,
    isVisible: () => visible,
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
    setReducedMotion(value: boolean) { reducedMotion = value; },
    setPixelRatio(value: number) { pixelRatio = value; },
    setVisible(value: boolean) { visible = value; },
  };
}

describe('useStreamingScrollGlide', () => {
  let app: App<Element> | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
  });

  async function setup() {
    const fake = createFakeEnvironment();
    const scroll = document.createElement('div');
    const content = document.createElement('div');
    const active = ref(true);
    const streaming = ref(true);
    let applyScroll: ((deltaPx: number, isSizeAdjustment: boolean) => void) | undefined;
    const gesture = ref(false);
    const scrollRef = ref<HTMLElement | null>(scroll);
    const contentRef = ref<HTMLElement | null>(content);
    const Host = defineComponent({
      setup() {
        const glide = useStreamingScrollGlide({
          scrollElement: scrollRef,
          contentElement: contentRef,
          isActive: () => active.value,
          isStreaming: () => streaming.value,
          isUserGestureActive: () => gesture.value,
          environment: fake.environment,
        });
        applyScroll = glide.onScrollApplied;
        return () => h('div');
      },
    });
    app = createApp(Host);
    app.mount(document.createElement('div'));
    await nextTick();
    const offset = () => {
      const match = /translate3d\(0, (-?[\d.]+)px, 0\)/u.exec(content.style.transform);
      return match ? Number(match[1]) : 0;
    };
    const commitScroll = (value: number, isSizeAdjustment = true) => {
      const delta = value - scroll.scrollTop;
      scroll.scrollTop = value;
      applyScroll?.(delta, isSizeAdjustment);
    };
    return { fake, scroll, content, active, streaming, gesture, scrollRef, contentRef, offset, commitScroll };
  }

  it('真实滚动跳变后，内容层先被反向补回同样的位移，再逐帧滑动到 0', async () => {
    const f = await setup();
    f.commitScroll(22);
    expect(f.offset()).toBe(22);
    expect(f.content.style.willChange).toBe('transform');

    let previous = 22;
    for (let frame = 0; frame < 60 && f.offset() !== 0; frame += 1) {
      f.fake.tick();
      expect(f.offset()).toBeLessThanOrEqual(previous);
      previous = f.offset() || 0;
    }
    expect(f.offset()).toBe(0);
    expect(f.content.style.willChange).toBe('transform');
    expect(f.fake.pendingFrames()).toBe(0);
  });

  it('同次滚动提交已经补偿，晚到的 scroll 事件不重复吸收；外部滚动立即撤销', async () => {
    const f = await setup();
    f.commitScroll(28);
    expect(f.offset()).toBe(28);
    f.scroll.dispatchEvent(new Event('scroll'));
    expect(f.offset()).toBe(28);
    f.fake.tick();
    const offset = f.offset();
    f.scroll.dispatchEvent(new Event('scroll'));
    expect(f.offset()).toBe(offset);
    f.scroll.scrollTop += 10;
    f.scroll.dispatchEvent(new Event('scroll'));
    expect(f.offset()).toBe(0);
    expect(f.fake.pendingFrames()).toBe(0);
  });

  it('手动导航与内容收缩不缓动，即使位移只有一行', async () => {
    const f = await setup();
    f.commitScroll(28);
    f.commitScroll(40, false);
    expect(f.offset()).toBe(0);
    f.commitScroll(68);
    f.commitScroll(50);
    expect(f.offset()).toBe(0);
  });

  it('流式结束让残余动画自然落定，停顿期间保持合成层', async () => {
    const f = await setup();
    f.commitScroll(28);
    f.streaming.value = false;
    expect(f.offset()).toBe(28);
    for (let i = 0; i < 60; i += 1) f.fake.tick();
    expect(f.offset()).toBe(0);
    expect(f.content.style.transform).toBe('');
    expect(f.content.style.willChange).toBe('');
    f.commitScroll(56);
    expect(f.offset()).toBe(0);
  });

  it('隐藏页面立即撤销，重新可见时不重播旧位移', async () => {
    const f = await setup();
    f.commitScroll(28);
    f.fake.setVisible(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.offset()).toBe(0);
    expect(f.fake.pendingFrames()).toBe(0);
    f.commitScroll(56);
    f.fake.setVisible(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.offset()).toBe(0);
  });

  it('替换消息内容宿主时清理旧节点与调度，不跨宿主继承动画', async () => {
    const f = await setup();
    f.commitScroll(28);
    f.contentRef.value = document.createElement('div');
    await nextTick();
    expect(f.content.style.transform).toBe('');
    expect(f.fake.pendingFrames()).toBe(0);
  });

  it('位移按设备像素取整：2x 屏是 0.5px 的整数倍，1x 屏是整数', async () => {
    const f = await setup();
    f.commitScroll(22);
    for (let frame = 0; frame < 30 && f.offset() !== 0; frame += 1) {
      f.fake.tick();
      expect((f.offset() * 2) % 1).toBe(0);
    }

    f.fake.setPixelRatio(1);
    f.commitScroll(44);
    for (let frame = 0; frame < 30 && f.offset() !== 0; frame += 1) {
      f.fake.tick();
      expect(f.offset() % 1).toBe(0);
    }
  });

  it('连续跳变会累加，不会各自重置', async () => {
    const f = await setup();
    f.commitScroll(22);
    f.fake.tick();
    const afterFirst = f.offset();
    f.commitScroll(44);
    expect(f.offset()).toBeCloseTo(afterFirst + 22, 1);
  });

  it('不在跟随底部或不在流式时不缓动', async () => {
    const f = await setup();
    f.active.value = false;
    f.commitScroll(22);
    expect(f.offset()).toBe(0);
    expect(f.fake.pendingFrames()).toBe(0);
  });

  it('变为不活跃时立即清零并停止调度', async () => {
    const f = await setup();
    f.commitScroll(22);
    expect(f.offset()).toBe(22);
    f.active.value = false;
    expect(f.offset()).toBe(0);
    expect(f.fake.pendingFrames()).toBe(0);
  });

  it('用户手势进行中不缓动，缓动途中出现手势则下一帧立即清零', async () => {
    const f = await setup();
    f.gesture.value = true;
    f.commitScroll(22);
    expect(f.offset()).toBe(0);

    f.gesture.value = false;
    f.commitScroll(44);
    expect(f.offset()).toBe(22);
    f.gesture.value = true;
    f.fake.tick();
    expect(f.offset()).toBe(0);
    expect(f.fake.pendingFrames()).toBe(0);
  });

  it('开启“减少动态效果”时不缓动', async () => {
    const f = await setup();
    f.fake.setReducedMotion(true);
    f.commitScroll(22);
    expect(f.offset()).toBe(0);
  });

  it('单次跳变过大（结构性滚动）清零并放弃缓动', async () => {
    const f = await setup();
    f.commitScroll(22);
    f.commitScroll(1000);
    expect(f.offset()).toBe(0);
    expect(f.fake.pendingFrames()).toBe(0);
  });

  it('不活跃期间的滚动也会更新基准，重新活跃后的第一次跳变只算增量', async () => {
    const f = await setup();
    f.active.value = false;
    f.commitScroll(500);
    f.active.value = true;
    f.commitScroll(522);
    expect(f.offset()).toBe(22);
  });

  it('卸载时清除内容层的位移与监听', async () => {
    const f = await setup();
    f.commitScroll(22);
    app?.unmount();
    app = null;
    expect(f.content.style.transform).toBe('');
    expect(f.fake.pendingFrames()).toBe(0);
    f.commitScroll(44);
    expect(f.content.style.transform).toBe('');
  });
});
