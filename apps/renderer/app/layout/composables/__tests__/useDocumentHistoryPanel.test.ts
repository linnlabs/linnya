// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref, shallowRef, type EffectScope } from 'vue';
import {
  cancelDocumentHistoryPanelRequest,
  requestDocumentHistoryPanel,
} from '@/app/layout/orchestration/documentHistoryPanelRequest';
import { useDocumentHistoryPanel } from '../useDocumentHistoryPanel';

const previewComponent = { name: 'HistoryPreview' };

function mountPanel(sessions: Record<string, string>) {
  const activeDocumentId = ref<string | null>(null);
  const historyPreviewComponent = shallowRef<object | undefined>(previewComponent);
  const scope: EffectScope = effectScope();
  const panel = scope.run(() => useDocumentHistoryPanel({
    activeDocumentId,
    historyPreviewComponent,
    readClientSessionId: (documentId) => sessions[documentId],
  }));
  if (!panel) throw new Error('panel not created');
  return { activeDocumentId, historyPreviewComponent, panel, scope };
}

describe('useDocumentHistoryPanel', () => {
  let scope: EffectScope | undefined;

  afterEach(() => {
    scope?.stop();
    cancelDocumentHistoryPanelRequest('doc-a');
    cancelDocumentHistoryPanelRequest('doc-b');
  });

  it('records the edit session when another surface requests the panel', async () => {
    const mounted = mountPanel({ 'doc-a': 'session-a' });
    scope = mounted.scope;

    requestDocumentHistoryPanel('doc-a');
    mounted.activeDocumentId.value = 'doc-a';
    await nextTick();

    expect(mounted.panel.showDocumentHistory.value).toBe(true);
    expect(mounted.panel.historyClientSessionId.value).toBe('session-a');
  });

  it('records the edit session for the menu entry', async () => {
    const mounted = mountPanel({ 'doc-a': 'session-a' });
    scope = mounted.scope;
    mounted.activeDocumentId.value = 'doc-a';
    await nextTick();

    mounted.panel.openDocumentHistory();

    expect(mounted.panel.showDocumentHistory.value).toBe(true);
    expect(mounted.panel.historyClientSessionId.value).toBe('session-a');
  });

  it('closes the panel and forgets the session when the document changes', async () => {
    const mounted = mountPanel({ 'doc-a': 'session-a' });
    scope = mounted.scope;
    mounted.activeDocumentId.value = 'doc-a';
    await nextTick();
    mounted.panel.openDocumentHistory();

    mounted.activeDocumentId.value = 'doc-b';
    await nextTick();

    expect(mounted.panel.showDocumentHistory.value).toBe(false);
    expect(mounted.panel.historyClientSessionId.value).toBeUndefined();
  });

  it('opens a requested panel after switching documents with the new document session', async () => {
    const mounted = mountPanel({ 'doc-a': 'session-a', 'doc-b': 'session-b' });
    scope = mounted.scope;
    mounted.activeDocumentId.value = 'doc-a';
    await nextTick();
    mounted.panel.openDocumentHistory();

    requestDocumentHistoryPanel('doc-b');
    mounted.activeDocumentId.value = 'doc-b';
    await nextTick();

    expect(mounted.panel.showDocumentHistory.value).toBe(true);
    expect(mounted.panel.historyClientSessionId.value).toBe('session-b');
  });

  it('keeps a request pending while the document type has no history preview', async () => {
    const mounted = mountPanel({ 'doc-a': 'session-a' });
    scope = mounted.scope;
    mounted.historyPreviewComponent.value = undefined;

    requestDocumentHistoryPanel('doc-a');
    mounted.activeDocumentId.value = 'doc-a';
    await nextTick();
    expect(mounted.panel.showDocumentHistory.value).toBe(false);

    mounted.historyPreviewComponent.value = previewComponent;
    await nextTick();
    expect(mounted.panel.showDocumentHistory.value).toBe(true);
    expect(mounted.panel.historyClientSessionId.value).toBe('session-a');
  });
});
