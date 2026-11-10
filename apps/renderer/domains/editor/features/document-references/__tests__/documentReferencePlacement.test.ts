// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { positionDocumentReferencePreview } from '../ui/positionDocumentReferencePreview';

class ObservedResize implements ResizeObserver {
  static readonly active = new Set<ObservedResize>();
  private readonly elements = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    ObservedResize.active.add(this);
  }
  observe(element: Element) {
    this.elements.add(element);
  }
  unobserve(element: Element) {
    this.elements.delete(element);
  }
  disconnect() {
    this.elements.clear();
    ObservedResize.active.delete(this);
  }
  static resized(element: Element) {
    const entry: ResizeObserverEntry = {
      target: element,
      contentRect: element.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    };
    for (const observer of this.active)
      if (observer.elements.has(element)) observer.callback([entry], observer);
  }
}
afterEach(() => {
  for (const observer of ObservedResize.active) observer.disconnect();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** jsdom无排版引擎：只补DOM测量与CSS尺寸约束，翻转/位移计算仍运行真实Floating UI。 */
function layout() {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', ObservedResize);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  const viewport = { width: 1280, height: 900 },
    anchor = { x: 600, y: 498, width: 80, height: 21 },
    content = { width: 352, height: 80 };
  const reference = document.createElement('span'),
    panel = document.createElement('section');
  panel.style.cssText =
    'position:fixed;left:0px;top:0px;width:352px;box-sizing:border-box;overflow:auto';
  panel.tabIndex = -1;
  panel.style.setProperty('--document-reference-available-width', '1264px');
  panel.style.setProperty('--document-reference-available-height', '884px');
  document.body.append(reference, panel);
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockImplementation(() => viewport.width);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockImplementation(
    () => viewport.height
  );
  const measure = () =>
    new DOMRect(
      Number.parseFloat(panel.style.left),
      Number.parseFloat(panel.style.top),
      Math.min(
        content.width,
        Number.parseFloat(panel.style.getPropertyValue('--document-reference-available-width'))
      ),
      Math.min(
        content.height,
        512,
        viewport.height * 0.8,
        Number.parseFloat(panel.style.getPropertyValue('--document-reference-available-height'))
      )
    );
  vi.spyOn(reference, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(anchor.x, anchor.y, anchor.width, anchor.height)
  );
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(measure);
  Object.defineProperties(reference, {
    offsetWidth: { configurable: true, get: () => anchor.width },
    offsetHeight: { configurable: true, get: () => anchor.height },
  });
  Object.defineProperties(panel, {
    offsetWidth: { configurable: true, get: () => measure().width },
    offsetHeight: { configurable: true, get: () => measure().height },
    clientHeight: { configurable: true, get: () => measure().height },
    scrollHeight: { configurable: true, get: () => content.height },
  });
  return { reference, panel, content, viewport, anchor, measure };
}
function inViewport(panel: HTMLElement, viewport: { width: number; height: number }) {
  const bounds = panel.getBoundingClientRect();
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(viewport.width);
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
}
it('封面异步变高后按真实大小翻转/约束，屏幕下半部的展开按钮仍可进入与操作', async () => {
  const f = layout(),
    report = vi.fn(),
    stop = positionDocumentReferencePreview({ reference: f.reference, panel: f.panel, report });
  try {
    await vi.advanceTimersByTimeAsync(20);
    inViewport(f.panel, f.viewport);
    const initialHeight = f.measure().height;
    await Promise.resolve();
    f.content.height = 512;
    const expand = document.createElement('button'),
      open = vi.fn();
    expand.textContent = '展开';
    expand.onclick = open;
    f.panel.append(expand);
    ObservedResize.resized(f.panel);
    await vi.advanceTimersByTimeAsync(20);
    inViewport(f.panel, f.viewport);
    expect(f.measure().height).toBeGreaterThan(initialHeight);
    expect(f.panel.scrollHeight).toBeGreaterThan(f.panel.clientHeight);
    expand.focus();
    expand.click();
    expect(document.activeElement).toBe(expand);
    expect(open).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
it('边缘与小窗变化保持只读翻页控件可达，宿主transform式移动也重新锚定', async () => {
  const f = layout(),
    stop = positionDocumentReferencePreview({
      reference: f.reference,
      panel: f.panel,
      report: error => {
        throw error;
      },
    });
  try {
    f.content.height = 1000;
    ObservedResize.resized(f.panel);
    await vi.advanceTimersByTimeAsync(20);
    f.viewport.width = 240;
    f.viewport.height = 220;
    f.anchor.x = 210;
    f.anchor.y = 180;
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(20);
    inViewport(f.panel, f.viewport);
    expect(f.panel.scrollHeight).toBeGreaterThan(f.panel.clientHeight);
    const page = document.createElement('button'),
      next = vi.fn();
    page.textContent = '下一页';
    page.onclick = next;
    f.panel.append(page);
    page.focus();
    page.click();
    expect(next).toHaveBeenCalledOnce();
    f.anchor.x = 20;
    f.anchor.y = 40;
    await vi.advanceTimersByTimeAsync(20);
    inViewport(f.panel, f.viewport);
  } finally {
    stop();
  }
});
it('异步长封面翻到标签上方后，移入展开使内容缩短也保留原侧与鼠标位置；空间不足才翻转', async () => {
  const f = layout(),
    report = vi.fn(),
    stop = positionDocumentReferencePreview({ reference: f.reference, panel: f.panel, report });
  try {
    // 缓存封面可以在首次异步定位完成前到达，必须按它的真实高度选侧。
    await Promise.resolve();
    f.content.height = 512;
    ObservedResize.resized(f.panel);
    await vi.advanceTimersByTimeAsync(20);
    inViewport(f.panel, f.viewport);
    const before = f.measure(),
      pointer = { x: before.left + 30, y: before.bottom - 20 };
    expect(before.bottom).toBeLessThanOrEqual(f.anchor.y);
    f.panel.addEventListener('mouseenter', () => {
      f.content.height = 180;
      ObservedResize.resized(f.panel);
    });
    f.panel.dispatchEvent(new MouseEvent('mouseenter', { clientX: pointer.x, clientY: pointer.y }));
    await vi.advanceTimersByTimeAsync(20);
    const expanded = f.measure();
    expect(expanded.bottom).toBeLessThanOrEqual(f.anchor.y);
    expect(pointer.x).toBeGreaterThanOrEqual(expanded.left);
    expect(pointer.x).toBeLessThanOrEqual(expanded.right);
    expect(pointer.y).toBeGreaterThanOrEqual(expanded.top);
    expect(pointer.y).toBeLessThanOrEqual(expanded.bottom);
    f.viewport.height = 220;
    f.anchor.y = 8;
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(20);
    inViewport(f.panel, f.viewport);
    expect(f.measure().top).toBeGreaterThanOrEqual(f.anchor.y + f.anchor.height);
    expect(report).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
it('关闭先停止观察与RAF，迟到的定位计算不修改已销毁浮层', async () => {
  const f = layout(),
    report = vi.fn(),
    stop = positionDocumentReferencePreview({ reference: f.reference, panel: f.panel, report });
  await vi.advanceTimersByTimeAsync(20);
  f.anchor.y = 50;
  f.content.height = 800;
  ObservedResize.resized(f.panel);
  const previous = f.panel.style.cssText;
  stop();
  f.panel.remove();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.panel.style.cssText).toBe(previous);
  expect(ObservedResize.active.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(report).not.toHaveBeenCalled();
});
