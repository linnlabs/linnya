import type { ConversationReferenceProviderContribution } from '@linnya/plugin-host-contract/renderer';

const referenceProviders = new Map<string, ConversationReferenceProviderContribution>();

function requireIdentityPart(value: string, field: 'pluginId' | 'id'): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`[composerReferences] provider ${field} 不能为空`);
  }
  return normalized;
}

function buildReferenceProviderKey(pluginId: string, id: string): string {
  return `${requireIdentityPart(pluginId, 'pluginId')}:${requireIdentityPart(id, 'id')}`;
}

export function registerConversationReferenceProvider(
  contribution: ConversationReferenceProviderContribution,
): void {
  const key = buildReferenceProviderKey(contribution.pluginId, contribution.id);
  if (referenceProviders.has(key)) {
    throw new Error(`[composerReferences] provider 重复注册: ${key}`);
  }
  referenceProviders.set(key, contribution);
}

export function unregisterConversationReferenceProvider(pluginId: string, id: string): boolean {
  return referenceProviders.delete(buildReferenceProviderKey(pluginId, id));
}

export function readConversationReferenceProviders(): readonly ConversationReferenceProviderContribution[] {
  return Array.from(referenceProviders.values());
}

export function clearConversationReferenceProvidersForTest(): void {
  referenceProviders.clear();
}
