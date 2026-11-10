// @vitest-environment jsdom
import { nextTick } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import { createComposerReferenceHover } from './createComposerReferenceHover';

afterEach(() => vi.unstubAllGlobals());

const rect = (top: number, height: number, left = 100, width = 60): DOMRect => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

function openHover(triggerTop: number) {
  let resized = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('innerWidth', 1400);
  const anchor = document.createElement('button'),
    panel = document.createElement('div');
  anchor.getBoundingClientRect = () => rect(triggerTop, 18);
  let panelHeight = 40;
  panel.getBoundingClientRect = () => rect(0, panelHeight, 0, 352);
  const hover = createComposerReferenceHover({ anchor: () => anchor, panel: () => panel });
  return {
    hover,
    grow(height: number) {
      panelHeight = height;
      resized();
    },
  };
}

it('stays above the reference while the preview grows, so it never covers the pointer', async () => {
  const { hover, grow } = openHover(407);
  hover.enter(true);
  await nextTick();
  await nextTick();
  expect(hover.position.value).toMatchObject({
    bottom: '501px',
    '--conversation-reference-available-height': '391px',
  });
  grow(880);
  expect(hover.position.value.bottom).toBe('501px');
  expect(hover.position.value.top).toBeUndefined();
  hover.dispose();
});

it('opens below only when the room above cannot hold a preview', async () => {
  const { hover } = openHover(50);
  hover.enter(true);
  await nextTick();
  await nextTick();
  expect(hover.position.value).toMatchObject({
    top: '76px',
    '--conversation-reference-available-height': '816px',
  });
  expect(hover.position.value.bottom).toBeUndefined();
  hover.dispose();
});
