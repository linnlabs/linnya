import { expect, it, vi } from 'vitest';
import type { DocumentActionMenuContext } from '@plugin/renderer/pluginContribution';
import { createKnowledgeDocumentActions } from './knowledgeDocumentActions';

it('目标内容只读一次并冻结；停用后不发布迟到选择', async () => {
  let complete: (value: { markdown: string; displayName: string }) => void = () => {};
  const pending = new Promise<{ markdown: string; displayName: string }>(resolve => { complete = resolve; });
  const onError = vi.fn();
  const actions = createKnowledgeDocumentActions(onError);
  const context: DocumentActionMenuContext = { projectId: 'p', documentId: 'a', activeDocumentType: 'editor', displayName: 'A', readMarkdownSnapshot: vi.fn(() => pending) };
  const reading = actions.menu.select('add-to-kb', context);
  actions.cancel();
  complete({ markdown: 'saved A', displayName: 'A' });
  await reading;
  expect(actions.selection.value).toBeNull();
  expect(onError).not.toHaveBeenCalled();
  await actions.menu.select('add-to-kb', context);
  expect(actions.selection.value).toEqual({ projectId: 'p', documentId: 'a', markdown: 'saved A', displayName: 'A' });
});
