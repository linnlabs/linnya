import type {
  ConversationReferenceChipInput,
  ConversationReferenceKindContribution,
} from '@linnya/plugin-host-contract/renderer';

export interface ConversationReferenceChipPresentation {
  readonly label: string;
  readonly preview: string;
}

const referenceKinds = new Map<string, ConversationReferenceKindContribution>();

function requireIdentityPart(value: string, field: 'pluginId' | 'kind'): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`[composerReferences] ${field} 不能为空`);
  }
  return normalized;
}

function buildReferenceKindKey(pluginId: string, kind: string): string {
  return `${requireIdentityPart(pluginId, 'pluginId')}:${requireIdentityPart(kind, 'kind')}`;
}

export function registerConversationReferenceKind(
  contribution: ConversationReferenceKindContribution,
): void {
  const key = buildReferenceKindKey(contribution.pluginId, contribution.kind);
  if (referenceKinds.has(key)) {
    throw new Error(`[composerReferences] 引用类型重复注册: ${key}`);
  }
  referenceKinds.set(key, contribution);
}

export function unregisterConversationReferenceKind(pluginId: string, kind: string): boolean {
  return referenceKinds.delete(buildReferenceKindKey(pluginId, kind));
}

export function resolveConversationReferenceChipPresentation(
  reference: ConversationReferenceChipInput,
): ConversationReferenceChipPresentation {
  const key = buildReferenceKindKey(reference.pluginId, reference.kind);
  const contribution = referenceKinds.get(key);
  if (!contribution) {
    throw new Error(`[composerReferences] 引用类型未注册: ${key}`);
  }
  if (contribution.isValid && !contribution.isValid(reference)) {
    throw new Error(`[composerReferences] 引用已失效: ${key}#${reference.id}`);
  }
  return {
    label: contribution.chip.label(reference),
    preview: contribution.chip.preview(reference),
  };
}

export function clearConversationReferenceKindsForTest(): void {
  referenceKinds.clear();
}
