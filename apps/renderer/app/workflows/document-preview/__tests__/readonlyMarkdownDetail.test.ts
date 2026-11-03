// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { DocumentPreviewMarkdownRuntime } from '../definitions/documentPreviewDetail';
import { createReadonlyMarkdownDetail } from '../orchestration/createReadonlyMarkdownDetail';
it('shows loading for a deferred real parser and never writes its late result after scope or lifetime changes', async () => {
  const runtime = await import('@linnya/markdown-document-core');
  let finish: ((value: DocumentPreviewMarkdownRuntime) => void) | undefined;
  const host = document.createElement('div'),
    report = vi.fn();
  const preview = createReadonlyMarkdownDetail({
    element: () => host,
    load: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
    report,
  });
  const pending = preview.render({ format: 'markdown', text: '# Late' }, () => true);
  expect(preview.phase.value).toBe('loading');
  expect(host.childNodes).toHaveLength(0);
  preview.clear();
  finish?.(runtime);
  await pending;
  expect(host.childNodes).toHaveLength(0);
  expect(preview.phase.value).toBe('idle');
  const ready = createReadonlyMarkdownDetail({
    element: () => host,
    load: async () => runtime,
    report,
  });
  await ready.render({ format: 'markdown', text: '# Ready' }, () => true);
  expect(host.querySelector('h1')?.textContent).toBe('Ready');
  expect(ready.phase.value).toBe('ready');
  ready.clear();
  expect(host.childNodes).toHaveLength(0);
  expect(report).not.toHaveBeenCalled();
});
