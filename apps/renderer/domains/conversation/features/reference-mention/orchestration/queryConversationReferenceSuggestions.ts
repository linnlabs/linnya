import type { ConversationReferenceProviderContribution } from '@linnya/plugin-host-contract/renderer';
import type { ConversationReferenceSuggestionItem } from '../definitions/conversationReferenceSuggestion';

const DEFAULT_TRIGGER_CHAR = '@';

interface RankedSuggestion {
  readonly item: ConversationReferenceSuggestionItem;
  readonly providerOrder: number;
  readonly candidateOrder: number;
}

function isProviderAvailable(provider: ConversationReferenceProviderContribution): boolean {
  return (provider.triggerChar ?? DEFAULT_TRIGGER_CHAR) === DEFAULT_TRIGGER_CHAR
    && provider.isAvailable?.() !== false;
}

export function hasAvailableConversationReferenceProvider(
  providers: readonly ConversationReferenceProviderContribution[],
): boolean {
  return providers.some(isProviderAvailable);
}

function compareSuggestions(left: RankedSuggestion, right: RankedSuggestion): number {
  const priorityDifference = (right.item.provider.priority ?? 0) - (left.item.provider.priority ?? 0);
  if (priorityDifference !== 0) return priorityDifference;

  const scoreDifference = (right.item.candidate.score ?? 0) - (left.item.candidate.score ?? 0);
  if (scoreDifference !== 0) return scoreDifference;

  const providerOrderDifference = left.providerOrder - right.providerOrder;
  if (providerOrderDifference !== 0) return providerOrderDifference;

  return left.candidateOrder - right.candidateOrder;
}

function buildSuggestionKey(
  provider: ConversationReferenceProviderContribution,
  candidateId: string,
): string {
  return `${provider.pluginId}:${provider.id}:${candidateId}`;
}

/** 查询当前可用的 @ 候选源，并在宿主边界统一完成稳定排序与总量裁剪。 */
export async function queryConversationReferenceSuggestions(
  providers: readonly ConversationReferenceProviderContribution[],
  keyword: string,
  limit: number,
): Promise<ConversationReferenceSuggestionItem[]> {
  const availableProviders = providers.filter(isProviderAvailable);
  const providerResults = await Promise.all(availableProviders.map(async (provider) => ({
    provider,
    candidates: await provider.query({ keyword, limit }),
  })));

  const ranked = providerResults.flatMap(({ provider, candidates }, providerOrder) =>
    candidates.map((candidate, candidateOrder): RankedSuggestion => ({
      item: {
        key: buildSuggestionKey(provider, candidate.id),
        provider,
        candidate,
      },
      providerOrder,
      candidateOrder,
    }))
  );

  return ranked
    .sort(compareSuggestions)
    .slice(0, limit)
    .map(entry => entry.item);
}
