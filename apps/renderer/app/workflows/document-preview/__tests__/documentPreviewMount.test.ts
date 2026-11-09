// @vitest-environment jsdom
import { defineAsyncComponent, defineComponent, h, onUnmounted, type Component } from 'vue';
import { expect, it, vi } from 'vitest';
import type { DocumentReferencePresentation } from '@app/schemas';
import {
  registerRendererDocumentPreviewPort,
  mountDocumentPreview,
} from '@plugin/renderer/documentPreview';
import { createDocumentPreviewRendererPort } from '../orchestration/createDocumentPreviewRendererPort';
const available: DocumentReferencePresentation = {
  documentId: 'doc',
  title: 'Doc',
  nodeType: 'document',
  path: 'workspace:/Doc.md',
  status: 'available',
};
const input = () => ({
  element: document.createElement('div'),
  documentId: 'doc',
  projectId: 'project',
});
it('owns each element across overlapping imports and an old dispose cannot unmount the newer detail', async () => {
  let finish: ((component: Component) => void) | undefined;
  const unmounted = vi.fn(),
    staleSetup = vi.fn();
  const stale = defineComponent({
    setup() {
      staleSetup();
      return () => h('p', 'old');
    },
  });
  const current = defineComponent({
    setup() {
      onUnmounted(unmounted);
      return () => h('p', 'new');
    },
  });
  const load = vi
    .fn<() => Promise<Component>>()
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    )
    .mockResolvedValue(current);
  const port = createDocumentPreviewRendererPort({
    read: async () => available,
    currentProjectId: () => 'project',
    load,
  });
  const target = input(),
    older = port.mount(target);
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  const close = await port.mount(target);
  expect(target.element.textContent).toBe('new');
  finish?.(stale);
  (await older)();
  expect(staleSetup).not.toHaveBeenCalled();
  expect(target.element.textContent).toBe('new');
  close();
  close();
  expect(unmounted).toHaveBeenCalledOnce();
});
it('checks project again after loading and rejects a moved target before mounting', async () => {
  let project = 'project';
  const setup = vi.fn();
  const component = defineComponent({
    setup() {
      setup();
      return () => h('p');
    },
  });
  const port = createDocumentPreviewRendererPort({
    read: async () => available,
    currentProjectId: () => project,
    load: async () => {
      project = 'other';
      return component;
    },
  });
  const target = input();
  await expect(port.mount(target)).rejects.toThrow('不在当前项目');
  expect(target.element.childNodes).toHaveLength(0);
  expect(setup).not.toHaveBeenCalled();
  const moved = createDocumentPreviewRendererPort({
    read: vi
      .fn()
      .mockResolvedValueOnce(available)
      .mockResolvedValue({ ...available, status: 'outside_project' }),
    currentProjectId: () => 'project',
    load: async () => component,
  });
  await expect(moved.mount(target)).rejects.toThrow('不在当前项目');
  expect(setup).not.toHaveBeenCalled();
});
it('disposing an async document component before its chunk resolves leaves no VNode or subscription', async () => {
  let finish: ((component: Component) => void) | undefined;
  const setup = vi.fn();
  const component = defineAsyncComponent(
    () =>
      new Promise<Component>(resolve => {
        finish = resolve;
      })
  );
  const port = createDocumentPreviewRendererPort({
    read: async () => available,
    currentProjectId: () => 'project',
    load: async () => component,
  });
  const target = input(),
    close = await port.mount(target);
  close();
  finish?.(
    defineComponent({
      setup() {
        setup();
        return () => h('p', 'late');
      },
    })
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(setup).not.toHaveBeenCalled();
  expect(target.element.childNodes).toHaveLength(0);
});

it('aborts before a deferred import can mount and releases a mounted detail immediately on abort', async () => {
  let finish: ((component: Component) => void) | undefined;
  const setup = vi.fn(),
    unmount = vi.fn();
  const component = defineComponent({
    setup() {
      setup();
      onUnmounted(unmount);
      return () => h('p', 'detail');
    },
  });
  const load = vi
    .fn<() => Promise<Component>>()
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    )
    .mockResolvedValue(component);
  const port = createDocumentPreviewRendererPort({
    read: async () => available,
    currentProjectId: () => 'project',
    load,
  });
  const abort = new AbortController(),
    target = input(),
    mounting = port.mount({ ...target, signal: abort.signal });
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  abort.abort();
  finish?.(component);
  await expect(mounting).rejects.toMatchObject({ name: 'AbortError' });
  expect(setup).not.toHaveBeenCalled();
  expect(target.element.childNodes).toHaveLength(0);
  registerRendererDocumentPreviewPort(port);
  const active = new AbortController(),
    dispose = await mountDocumentPreview({ ...target, signal: active.signal });
  expect(setup).toHaveBeenCalledOnce();
  active.abort();
  expect(target.element.childNodes).toHaveLength(0);
  dispose();
  expect(unmount).toHaveBeenCalledOnce();
});
