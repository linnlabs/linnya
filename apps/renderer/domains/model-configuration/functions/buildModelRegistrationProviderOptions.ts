import type {
  ProviderConnectionDefinition,
  ProviderDefinition,
} from '../features/provider-catalog';
import {
  CUSTOM_PROVIDER_SELECTION,
  type ModelRegistrationQuickProviderOption,
  type ModelRegistrationConnectionChoice,
  type ModelRegistrationProviderOption,
  type ModelRegistrationProviderSelection,
} from '../definitions/modelRegistrationProviderSelection';

interface ModelRegistrationProviderOptionLabels {
  readonly custom: string;
}

const COMMON_PROVIDER_DEFINITION_IDS = [
  'openai',
  'opencode-go',
  'moonshot',
  'anthropic',
] as const;
const COMMON_PROVIDER_DISPLAY_ORDER = ['openai', 'opencode-go'] as const;
const KIMI_PROVIDER_DEFINITION_ID = 'moonshot';
const CLAUDE_PROVIDER_DEFINITION_ID = 'anthropic';
const OLLAMA_PROVIDER_DEFINITION_ID = 'ollama';
const OLLAMA_CLOUD_CONNECTION_DEFINITION_ID = 'ollama-cloud';

function providerSelection(providerDefinitionId: string): `provider:${string}` {
  return `provider:${providerDefinitionId}`;
}

function isSupportedConnection(connection: ProviderConnectionDefinition): boolean {
  return (
    (connection.kind === 'direct' &&
      ((connection.model_discovery === 'bundled' && connection.models.length > 0) ||
        connection.model_discovery === 'account_catalog')) ||
    (connection.kind === 'local_runtime' && connection.model_discovery === 'local_runtime')
  );
}

function isAvailableConnection(
  connection: ProviderConnectionDefinition,
  configuredConnectionIds: ReadonlySet<string>
): boolean {
  const isConfiguredBundledDirect =
    connection.kind === 'direct' &&
    connection.model_discovery === 'bundled' &&
    configuredConnectionIds.has(connection.id);
  return isSupportedConnection(connection) && !isConfiguredBundledDirect;
}

export function buildModelRegistrationProviderOptions(
  providers: readonly ProviderDefinition[],
  labels: ModelRegistrationProviderOptionLabels,
  configuredConnectionIds: ReadonlySet<string> = new Set()
): ModelRegistrationProviderOption[] {
  const providerOptions = providers
    .filter(provider =>
      provider.connections.some(connection =>
        isAvailableConnection(connection, configuredConnectionIds)
      )
    )
    .map(provider => ({
      value: providerSelection(provider.id),
      text: provider.display_name,
    }));

  return [{ value: CUSTOM_PROVIDER_SELECTION, text: labels.custom }, ...providerOptions];
}

/**
 * 首屏只展示几个高频入口。这里复用 Provider Catalog 的可用性判断，
 * 已经配置且没有其他可用接入方式的 Provider 不会被重复推荐。
 */
export function buildModelRegistrationCommonProviderOptions(
  providers: readonly ProviderDefinition[],
  configuredConnectionIds: ReadonlySet<string> = new Set()
): ModelRegistrationQuickProviderOption[] {
  const options: ModelRegistrationQuickProviderOption[] = [];

  for (const providerDefinitionId of COMMON_PROVIDER_DISPLAY_ORDER) {
    const provider = providers.find(candidate => candidate.id === providerDefinitionId);
    if (
      !provider ||
      !provider.connections.some(connection =>
        isAvailableConnection(connection, configuredConnectionIds)
      )
    ) {
      continue;
    }
    options.push({ value: providerSelection(provider.id), text: provider.display_name });
  }

  const ollamaProvider = providers.find(
    candidate => candidate.id === OLLAMA_PROVIDER_DEFINITION_ID
  );
  const ollamaAvailableConnections = ollamaProvider?.connections.filter(connection =>
    isAvailableConnection(connection, configuredConnectionIds)
  ) ?? [];
  const ollamaCloudConnection = ollamaProvider?.connections.find(
    connection => connection.id === OLLAMA_CLOUD_CONNECTION_DEFINITION_ID
  );
  const hasAvailableOllamaCloud = ollamaCloudConnection
    ? isAvailableConnection(ollamaCloudConnection, configuredConnectionIds)
    : false;
  if (ollamaAvailableConnections.length > 0 && ollamaProvider) {
    options.push({
      value: providerSelection(OLLAMA_PROVIDER_DEFINITION_ID),
      text: hasAvailableOllamaCloud && ollamaCloudConnection
        ? ollamaCloudConnection.display_name
        : ollamaProvider.display_name,
      ...(hasAvailableOllamaCloud && ollamaCloudConnection
        ? { preferredConnectionDefinitionId: ollamaCloudConnection.id }
        : {}),
    });
  }

  const kimiProvider = providers.find(
    candidate => candidate.id === KIMI_PROVIDER_DEFINITION_ID
  );
  if (
    kimiProvider &&
    kimiProvider.connections.some(connection =>
      isAvailableConnection(connection, configuredConnectionIds)
    )
  ) {
    options.push({ value: providerSelection(kimiProvider.id), text: kimiProvider.display_name });
  }

  const claudeProvider = providers.find(
    candidate => candidate.id === CLAUDE_PROVIDER_DEFINITION_ID
  );
  if (
    claudeProvider &&
    claudeProvider.connections.some(connection =>
      isAvailableConnection(connection, configuredConnectionIds)
    )
  ) {
    options.push({
      value: providerSelection(claudeProvider.id),
      // 用户识别的是 Claude 模型品牌；详情页仍保留目录中的 Anthropic Provider 名称。
      text: 'Claude',
    });
  }

  return options;
}

/** 其他供应商保留现有目录，但不重复首屏展示的品牌入口。 */
export function buildModelRegistrationOtherProviderOptions(
  providers: readonly ProviderDefinition[],
  configuredConnectionIds: ReadonlySet<string> = new Set()
): ModelRegistrationProviderOption[] {
  const commonProviderIds = new Set<string>([
    ...COMMON_PROVIDER_DEFINITION_IDS,
    OLLAMA_PROVIDER_DEFINITION_ID,
  ]);
  return buildModelRegistrationProviderOptions(
    providers,
    { custom: '' },
    configuredConnectionIds
  ).filter(option => {
    if (option.value === CUSTOM_PROVIDER_SELECTION || !option.value.startsWith('provider:')) {
      return false;
    }
    return !commonProviderIds.has(option.value.slice('provider:'.length));
  });
}

export function buildModelRegistrationConnectionOptions(
  selection: ModelRegistrationProviderSelection,
  providers: readonly ProviderDefinition[],
  configuredConnectionIds: ReadonlySet<string> = new Set()
): ModelRegistrationConnectionChoice[] {
  const providerDefinitionId = resolveProviderDefinitionId(selection);
  const provider = providers.find(candidate => candidate.id === providerDefinitionId);
  return (provider?.connections ?? [])
    .filter(connection => isAvailableConnection(connection, configuredConnectionIds))
    .map(connection => ({
      value: `connection:${connection.id}`,
      label: connection.display_name,
      ...(connection.description ? { description: connection.description } : {}),
      ...(connection.badge ? { badge: connection.badge } : {}),
    }));
}

export function resolveApiKeyProviderConnectionDefinitionId(
  selection: string | null,
  providers: readonly ProviderDefinition[]
): string | undefined {
  const connection = resolveConnection(selection, providers);
  return connection?.kind === 'direct' &&
    connection.setup_fields.some(field => field.kind === 'secret')
    ? connection.id
    : undefined;
}

export function resolveAccountProviderConnectionDefinitionId(
  selection: string | null,
  providers: readonly ProviderDefinition[]
): string | undefined {
  const connection = resolveConnection(selection, providers);
  return connection?.kind === 'direct' &&
    connection.setup_fields.some(field => field.kind === 'oauth')
    ? connection.id
    : undefined;
}

export function resolveLocalRuntimeProviderConnectionDefinitionId(
  selection: string | null,
  providers: readonly ProviderDefinition[]
): string | undefined {
  const connection = resolveConnection(selection, providers);
  return connection?.kind === 'local_runtime' ? connection.id : undefined;
}

function resolveProviderDefinitionId(
  selection: ModelRegistrationProviderSelection
): string | undefined {
  return selection.startsWith('provider:') ? selection.slice('provider:'.length) : undefined;
}

function resolveConnection(
  selection: string | null,
  providers: readonly ProviderDefinition[]
): ProviderConnectionDefinition | undefined {
  const connectionId = selection?.startsWith('connection:')
    ? selection.slice('connection:'.length)
    : undefined;
  if (!connectionId) return undefined;
  return providers
    .flatMap(provider => provider.connections)
    .find(connection => connection.id === connectionId);
}
