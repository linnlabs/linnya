import { describe, expect, it, vi } from 'vitest';
import type {
  ConversationReferenceCandidate,
  ConversationReferenceProviderContribution,
} from '@linnya/plugin-host-contract/renderer';
import {
  hasAvailableConversationReferenceProvider,
  queryConversationReferenceSuggestions,
} from './queryConversationReferenceSuggestions';

function createProvider(input: {
  pluginId: string;
  id: string;
  priority?: number;
  triggerChar?: string;
  available?: boolean;
  candidates: ConversationReferenceCandidate[];
}): ConversationReferenceProviderContribution {
  return {
    pluginId: input.pluginId,
    id: input.id,
    priority: input.priority,
    triggerChar: input.triggerChar,
    isAvailable: input.available === undefined ? undefined : () => input.available === true,
    query: vi.fn().mockResolvedValue(input.candidates),
    resolveReference: candidate => ({ text: candidate.label }),
  };
}

describe('queryConversationReferenceSuggestions', () => {
  it('只查询当前可用的 @ provider，并透传 keyword 与 limit', async () => {
    const workspaceProvider = createProvider({
      pluginId: 'platform',
      id: 'workspace',
      candidates: [{ id: 'doc-1', label: 'Roadmap' }],
    });
    const unavailableProvider = createProvider({
      pluginId: 'knowledgebase',
      id: 'document',
      available: false,
      candidates: [{ id: 'kb-1', label: 'Knowledge' }],
    });
    const otherTriggerProvider = createProvider({
      pluginId: 'platform',
      id: 'tag',
      triggerChar: '#',
      candidates: [{ id: 'tag-1', label: 'Tag' }],
    });

    const result = await queryConversationReferenceSuggestions(
      [workspaceProvider, unavailableProvider, otherTriggerProvider],
      'road',
      8,
    );

    expect(workspaceProvider.query).toHaveBeenCalledWith({ keyword: 'road', limit: 8 });
    expect(unavailableProvider.query).not.toHaveBeenCalled();
    expect(otherTriggerProvider.query).not.toHaveBeenCalled();
    expect(result.map(item => item.candidate.id)).toEqual(['doc-1']);
    expect(hasAvailableConversationReferenceProvider([
      unavailableProvider,
      otherTriggerProvider,
    ])).toBe(false);
    expect(hasAvailableConversationReferenceProvider([workspaceProvider])).toBe(true);
  });

  it('先按 provider priority、再按 candidate score 排序，并裁剪总量', async () => {
    const normalProvider = createProvider({
      pluginId: 'platform',
      id: 'workspace',
      priority: 10,
      candidates: [
        { id: 'doc-low', label: 'Low', score: 1 },
        { id: 'doc-high', label: 'High', score: 20 },
      ],
    });
    const priorityProvider = createProvider({
      pluginId: 'plugin-a',
      id: 'element',
      priority: 20,
      candidates: [{ id: 'element-1', label: 'Element', score: 0 }],
    });

    const result = await queryConversationReferenceSuggestions(
      [normalProvider, priorityProvider],
      '',
      2,
    );

    expect(result.map(item => item.key)).toEqual([
      'plugin-a:element:element-1',
      'platform:workspace:doc-high',
    ]);
  });
});
