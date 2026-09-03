import type {
  ProviderConnectionDefinition,
  ProviderDefinition,
} from '../features/provider-catalog';
import {
  CUSTOM_PROVIDER_SELECTION,
  type ModelRegistrationConnectionChoice,
  type ModelRegistrationProviderOption,
  type ModelRegistrationProviderSelection,
} from '../definitions/modelRegistrationProviderSelection';

interface ModelRegistrationProviderOptionLabels {
  readonly custom: string;
}

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
