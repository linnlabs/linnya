// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import { useSubmenu } from '../src/features/select-menu/composables/useSubmenu';
import {
  resolveSubmenuPosition,
  submenuViewportSize,
} from '../src/features/select-menu/functions/submenuGeometry';

const frames = new Map<number, FrameRequestCallback>();
let sequence = 0;
let unmount: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  unmount?.();
  frames.clear();
  vi.unstubAllGlobals();
});

async function frame() {
  await nextTick();
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
  await nextTick();
}

function mountSubmenu() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const menu = document.createElement('div');
  const parent = document.createElement('button');
  menu.appendChild(parent);
  host.appendChild(menu);
  let parentTop = 100;
  menu.getBoundingClientRect = () => new DOMRect(40, 40, 180, 240);
  parent.getBoundingClientRect = () => new DOMRect(40, parentTop, 180, 28);
  const optionsRef = ref<HTMLElement | null>(menu);
  const submenuRef = ref<HTMLElement | null>(null);
  let controls: ReturnType<typeof useSubmenu<string>> | undefined;
  const appHost = document.createElement('div');
  host.appendChild(appHost);
  const app = createApp({
    setup() {
      controls = useSubmenu<string>({ optionsRef, submenuRef });
      const submenu = controls;
      return () =>
        submenu.hoveredOptionWithChildren.value
          ? h(
              'div',
              {
                ref: submenuRef,
                style: submenu.submenuPosition.value,
              },
              submenu.hoveredOptionWithChildren.value.text
            )
          : null;
    },
  });
  app.mount(appHost);
  unmount = () => {
    app.unmount();
    host.remove();
  };
  if (!controls) throw new Error('Submenu controls were not mounted');
  return {
    ...controls,
    parent,
    menu,
    submenuRef,
    setParentTop: (top: number) => {
      parentTop = top;
    },
  };
}

const first = { text: 'First', children: [{ text: 'Child', value: 'child' }] };
const second = { text: 'Second', children: [{ text: 'Other', value: 'other' }] };

describe('submenu display and anchor lifecycle', () => {
  it('hands off only after visibility is committed and never from a cancelled open', async () => {
    const menu = mountSubmenu();
    const ready = vi.fn(() => expect(menu.submenuRef.value?.style.visibility).toBe('visible'));
    await menu.openSubmenu(first, menu.parent, ready);
    expect(menu.submenuRef.value?.style.visibility).toBe('hidden');
    expect(ready).not.toHaveBeenCalled();
    await frame();
    expect(ready).toHaveBeenCalledOnce();

    await menu.openSubmenu(first, menu.parent, ready);
    menu.forceCloseSubmenu();
    await frame();
    expect(ready).toHaveBeenCalledOnce();
    expect(menu.submenuRef.value).toBeNull();

    await menu.openSubmenu(first, menu.parent, ready);
    await menu.openSubmenu(second, menu.parent);
    await frame();
    expect(ready).toHaveBeenCalledOnce();
    expect(menu.submenuRef.value?.textContent).toBe('Second');

    await menu.openSubmenu(first, menu.parent, ready);
    unmount?.();
    unmount = undefined;
    await frame();
    expect(ready).toHaveBeenCalledOnce();
  });

  it('repositions visible anchors and closes once the parent has scrolled out', async () => {
    const menu = mountSubmenu();
    const ready = vi.fn();
    await menu.openSubmenu(first, menu.parent, ready);
    menu.setParentTop(10);
    menu.menu.dispatchEvent(new Event('scroll'));
    await frame();
    expect(menu.hoveredOptionWithChildren.value).toBeNull();
    expect(ready).not.toHaveBeenCalled();

    menu.setParentTop(100);
    await menu.openSubmenu(first, menu.parent);
    await frame();
    menu.setParentTop(140);
    menu.menu.dispatchEvent(new Event('scroll'));
    await frame();
    expect(menu.submenuPosition.value.top).toBe('140px');
    expect(menu.submenuRef.value?.style.visibility).toBe('visible');
    menu.setParentTop(10);
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(menu.hoveredOptionWithChildren.value).toBeNull();
  });
});

describe('submenu constrained geometry', () => {
  it('fits tall lists and near-edge anchors inside a narrow viewport', () => {
    const viewport = { width: 200, height: 240 };
    const panel = submenuViewportSize(viewport);
    for (const left of [-20, 20, 180]) {
      const parent = new DOMRect(left, 100, 180, 28);
      const position = resolveSubmenuPosition({ parent, menu: parent, panel, viewport });
      expect(position.top).toBeGreaterThanOrEqual(0);
      expect(position.top + panel.height).toBeLessThanOrEqual(viewport.height);
      expect(position.left).toBeGreaterThanOrEqual(0);
      expect(position.left + panel.width).toBeLessThanOrEqual(viewport.width);
    }
  });
});
