import { describe, expect, it, vi } from 'vitest';

vi.mock('@/domains/workspace/services/file-manager', () => ({
  getActiveFileSession: () => ({ documentId: 'deck', type: 'slides', displayName: 'Deck' }),
  requestSave: vi.fn(),
}));
vi.mock('@/domains/workspace/store', () => ({
  useWorkspaceProjectsStore: vi.fn(),
  useWorkspaceTreeStore: vi.fn(),
}));
vi.mock('@/app/plugins/registry', () => ({
  getDocumentTypeByFileSessionType: (type: string) => type === 'slides' ? { nodeType: 'presentation' } : null,
  getDocumentTypeByNodeType: vi.fn(),
}));

import { createWorkspaceContext } from './workspaceContext';
import {
  clearRendererPageContextProvidersForTest,
  getRendererPageContextProviderByDocumentType,
  registerRendererPageContextProvider,
} from '@plugin/renderer/pageContextProvider';

describe('active document context identity', () => {
  it('resolves the selection provider through document identity, even when the session type differs', () => {
    clearRendererPageContextProvidersForTest();
    registerRendererPageContextProvider({
      id: 'slides-test', kind: 'slides', documentType: 'presentation',
      buildSelection: () => ({ selectedElementIds: ['title'] }),
    });
    const session = createWorkspaceContext().getActiveDocumentSession();
    expect(session).toEqual({ documentId: 'deck', type: 'presentation', displayName: 'Deck' });
    expect(getRendererPageContextProviderByDocumentType(session?.type)?.buildSelection?.())
      .toEqual({ selectedElementIds: ['title'] });
    clearRendererPageContextProvidersForTest();
  });
});
