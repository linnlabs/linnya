import type {
  ConversationInputAccessoryContribution,
  ConversationReferenceProviderContribution,
  PluginConversationInputContribution,
} from '@plugin/renderer/conversationInputContribution';
import {
  registerConversationInputAccessory,
  unregisterConversationInputAccessory,
} from '@/domains/conversation/features/input-accessories';
import {
  registerConversationReferenceKind,
  registerConversationReferenceProvider,
  unregisterConversationReferenceKind,
  unregisterConversationReferenceProvider,
  useComposerReferences,
} from '@/domains/conversation/features/composer-references';

export interface RegisterPluginConversationInputOptions {
  readonly pluginId: string;
  readonly contribution: PluginConversationInputContribution;
  readonly isPluginActive: () => boolean;
}

function requireOwnedPluginId(ownerPluginId: string, childPluginId: string, identity: string): void {
  if (childPluginId !== ownerPluginId) {
    throw new Error(
      `[rendererPluginRegistry] conversationInput ${identity} 的 pluginId 必须与所属插件一致: owner=${ownerPluginId}, child=${childPluginId}`,
    );
  }
}

function validatePluginConversationInputOwnership(
  pluginId: string,
  contribution: PluginConversationInputContribution,
): void {
  for (const kind of contribution.referenceKinds) {
    requireOwnedPluginId(pluginId, kind.pluginId, `referenceKind ${kind.kind}`);
  }
  for (const provider of contribution.referenceProviders) {
    requireOwnedPluginId(pluginId, provider.pluginId, `referenceProvider ${provider.id}`);
  }
  for (const accessory of contribution.accessories ?? []) {
    requireOwnedPluginId(pluginId, accessory.pluginId, `accessory ${accessory.id}`);
  }
}

function gateProviderByPluginActivation(
  provider: ConversationReferenceProviderContribution,
  isPluginActive: () => boolean,
): ConversationReferenceProviderContribution {
  return {
    ...provider,
    isAvailable: () => isPluginActive() && provider.isAvailable?.() !== false,
  };
}

function gateAccessoryByPluginActivation(
  accessory: ConversationInputAccessoryContribution,
  isPluginActive: () => boolean,
): ConversationInputAccessoryContribution {
  return {
    ...accessory,
    isVisible: () => isPluginActive() && accessory.isVisible?.() !== false,
  };
}

/**
 * 在插件 activate 前预注册输入贡献；运行期 provider/accessory 在真正 active 前保持不可用。
 * 任一子贡献冲突时只回滚本次已注册项，不触碰原有注册者。
 */
export function registerPluginConversationInputContribution(
  options: RegisterPluginConversationInputOptions,
): void {
  validatePluginConversationInputOwnership(options.pluginId, options.contribution);

  const registeredKinds: Array<{ readonly pluginId: string; readonly kind: string }> = [];
  const registeredProviders: Array<{ readonly pluginId: string; readonly id: string }> = [];
  const registeredAccessories: Array<{ readonly pluginId: string; readonly id: string }> = [];
  try {
    for (const kind of options.contribution.referenceKinds) {
      registerConversationReferenceKind(kind);
      registeredKinds.push({ pluginId: kind.pluginId, kind: kind.kind });
    }
    for (const provider of options.contribution.referenceProviders) {
      registerConversationReferenceProvider(
        gateProviderByPluginActivation(provider, options.isPluginActive),
      );
      registeredProviders.push({ pluginId: provider.pluginId, id: provider.id });
    }
    for (const accessory of options.contribution.accessories ?? []) {
      registerConversationInputAccessory(
        gateAccessoryByPluginActivation(accessory, options.isPluginActive),
      );
      registeredAccessories.push({ pluginId: accessory.pluginId, id: accessory.id });
    }
  } catch (error) {
    for (const accessory of registeredAccessories.reverse()) {
      unregisterConversationInputAccessory(accessory.pluginId, accessory.id);
    }
    for (const provider of registeredProviders.reverse()) {
      unregisterConversationReferenceProvider(provider.pluginId, provider.id);
    }
    for (const kind of registeredKinds.reverse()) {
      unregisterConversationReferenceKind(kind.pluginId, kind.kind);
    }
    throw error;
  }
}

export function unregisterPluginConversationInputContribution(
  contribution: PluginConversationInputContribution,
): void {
  for (const accessory of [...(contribution.accessories ?? [])].reverse()) {
    unregisterConversationInputAccessory(accessory.pluginId, accessory.id);
  }
  for (const provider of [...contribution.referenceProviders].reverse()) {
    unregisterConversationReferenceProvider(provider.pluginId, provider.id);
  }
  for (const kind of [...contribution.referenceKinds].reverse()) {
    unregisterConversationReferenceKind(kind.pluginId, kind.kind);
  }
}

/** 注销 kind 前先移除当前草稿中的插件引用，避免标准 chip 解析已失去 owner。 */
export function removePluginComposerDraftReferences(pluginId: string): void {
  useComposerReferences().removeReferencesByPluginId(pluginId);
}
