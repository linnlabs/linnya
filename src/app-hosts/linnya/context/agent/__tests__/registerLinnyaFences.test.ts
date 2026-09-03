import { describe, expect, it, vi } from 'vitest';

const pluginFenceDescriptorsMock = vi.hoisted(() => ({
  getRegisteredAgentFenceDescriptors: vi.fn((): unknown[] => []),
}));

vi.mock('../../../plugin-registry/builtin', () => pluginFenceDescriptorsMock);

import { createLinnyaFenceRegistry } from '../registerLinnyaFences';

describe('createLinnyaFenceRegistry', () => {
  it('registers Linnya context engineering fences', () => {
    const registry = createLinnyaFenceRegistry();

    expect(registry.list().map(descriptor => descriptor.kind)).toEqual([
      'additional-context',
      'project-context',
      'document-context',
      'user-quote',
      'review-context',
    ]);
  });

  it('formats Linnya host-owned fences', () => {
    const registry = createLinnyaFenceRegistry();

    expect(registry.get('additional-context')?.formatter('Extra', {})).toBe(
      '<additional_context>\nExtra\n</additional_context>',
    );
    expect(registry.get('user-quote')?.formatter('Quote', { source_doc: 'doc-1', start: 1 })).toBe(
      '<user_quote source_doc="doc-1" start="1">\nQuote\n</user_quote>',
    );
    expect(registry.get('document-context')?.formatter('[page_context]\nkind=slides', {})).toBe(
      '<document_context>\n[page_context]\nkind=slides\n</document_context>',
    );
    expect(registry.get('review-context')?.formatter('Review this document.', {})).toBe('Review this document.');
  });

  it('exposes semantic categories for host-owned context fences', () => {
    const registry = createLinnyaFenceRegistry();
    const categories = Object.fromEntries(
      registry.list().map((descriptor) => [descriptor.kind, 'category' in descriptor ? descriptor.category : undefined]),
    );

    expect(categories['additional-context']).toBe('legacy');
    expect(categories['document-context']).toBe('current-view');
    expect(categories['user-quote']).toBe('selection');
  });

  it('merges enabled plugin fence descriptors lazily', () => {
    pluginFenceDescriptorsMock.getRegisteredAgentFenceDescriptors.mockReturnValue([{
      kind: 'selected-slides-element',
      category: 'selection',
      llmRole: 'user',
      placement: 'before-current-user',
      lifetime: 'turn-only',
      mustKeep: true,
      maxBudgetFraction: 0.25,
      formatter: (content: string) => `<selected_slides_element>\n${content.trim()}\n</selected_slides_element>`,
    }]);
    const registry = createLinnyaFenceRegistry();

    expect(registry.get('selected-slides-element')?.formatter('Source', {})).toBe(
      '<selected_slides_element>\nSource\n</selected_slides_element>',
    );
    expect(registry.get('selected-slides-element')).toMatchObject({
      category: 'selection',
      lifetime: 'turn-only',
      mustKeep: true,
    });
  });
});
