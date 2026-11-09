// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import {
  createDocumentPreviewSurface,
  type DocumentPreviewSurface,
} from '@linnya/document-preview';
import { createReadonlyDocumentSurface } from '../orchestration/createReadonlyDocumentSurface';
it('cancels a late presentation and releases the old resources when the target changes', async () => {
  const host = document.createElement('div'),
    report = vi.fn(),
    ready = vi.fn();
  let finish: ((surface: DocumentPreviewSurface) => void) | undefined;
  const result = await createDocumentPreviewSurface({
    document,
    signal: new AbortController().signal,
    widthPx: 300,
    theme: 'light',
    preview: {
      documentId: 'doc',
      title: 'Title',
      nodeType: 'document',
      status: 'ready',
      content: {
        revisionKey: '1',
        summary: '',
        detail: { format: 'text', text: 'Visible content' },
      },
    },
  });
  const dispose = vi.spyOn(result, 'dispose');
  const surface = createReadonlyDocumentSurface({
    element: () => host,
    report,
    ready,
    build: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  });
  const pending = surface.render(
    {
      widthPx: 300,
      theme: 'light',
      preview: {
        documentId: 'doc',
        title: 'Title',
        nodeType: 'document',
        status: 'preview_unavailable',
      },
    },
    () => true
  );
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(surface.phase.value).toBe('loading');
  surface.clear();
  finish?.(result);
  await pending;
  expect(host.childNodes).toHaveLength(0);
  expect(dispose).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  const current = createReadonlyDocumentSurface({ element: () => host, report, ready });
  await current.render(
    {
      widthPx: 300,
      theme: 'light',
      preview: {
        documentId: 'doc',
        title: 'Title',
        nodeType: 'document',
        status: 'ready',
        content: {
          revisionKey: '2',
          summary: '',
          detail: { format: 'text', text: 'Current content' },
        },
      },
    },
    () => true
  );
  expect(host.textContent).toContain('Current content');
  expect(ready).toHaveBeenCalledOnce();
  current.clear();
  expect(host.childNodes).toHaveLength(0);
  expect(report).not.toHaveBeenCalled();
});
