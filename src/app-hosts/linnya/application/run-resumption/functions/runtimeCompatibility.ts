import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { SerializableJsonRecord } from '@linnlabs/linnkit/contracts';
// JSON named exports 使 bundler 只保留版本与依赖事实，不能默认导入整份根配置及 scripts。
import { version as hostVersion, dependencies } from '../../../../../../package.json';
import { modelCatalog } from 'src/domains/model-catalog';
import {
  getAllSkillMetadata,
  getSkillByName,
  loadSkillContent,
  readSkillResource,
} from 'src/features/skills/catalog';
import { findRegisteredAgentDefinitionByPromptKey } from '../../../agent-registry/agentDefinitionResolver';
import { getRegisteredBackendPluginVersions } from '../../../plugin-registry/builtin';
import type { RunDescriptor } from '../definitions/runDescriptor';

type RuntimeCompatibility = RunDescriptor['compatibility'];

function serializeConfiguration(value: unknown): SerializableJsonRecord {
  const encoded = JSON.stringify(value, (_key, child: unknown) => {
    if (
      typeof child === 'function' ||
      typeof child === 'symbol' ||
      typeof child === 'bigint' ||
      (typeof child === 'number' && !Number.isFinite(child))
    )
      throw new Error('Run configuration is not serializable');
    return child;
  });
  return SerializableJsonRecord.parse(JSON.parse(encoded));
}

function readModelBinding(modelId: string): SerializableJsonRecord {
  const model = modelCatalog.getModel(modelId);
  if (!model) throw new Error(`Run model unavailable: ${modelId}`);
  const endpoint = model.inference_endpoint_id
    ? modelCatalog.getInferenceEndpoints().find(item => item.id === model.inference_endpoint_id)
    : undefined;
  if (model.inference_endpoint_id && !endpoint)
    throw new Error(`Run endpoint unavailable: ${modelId}`);
  return serializeConfiguration({
    id: model.id,
    inferenceRoute: model.inference_route,
    tokenRoute: model.token_route,
    tokenPricing: model.token_pricing,
    reasoning: model.reasoning,
    billingMode: model.billing_mode,
    clientRetry: model.enable_client_retry,
    credentialReference: model.credential_reference,
    endpoint: endpoint && {
      id: endpoint.id,
      routeProfileId: endpoint.route_profile_id,
      endpointId: endpoint.endpoint_id,
      baseUrl: endpoint.base_url,
      authProfile: endpoint.auth_profile,
      credentialReference: endpoint.credential_reference,
    },
  });
}

function readSkillRevision(name: string): string {
  const metadata = getSkillByName(name);
  if (!metadata) throw new Error(`Run skill unavailable: ${name}`);
  const content = loadSkillContent(name);
  // 已读取的正文仍是原 tool_output；未读取的指令必须能由当前 owner 提供同一版本。
  return createHash('sha256')
    .update(
      JSON.stringify({
        name,
        source: metadata.source,
        description: metadata.description,
        body: content.body,
        resources: content.resources
          .slice()
          .sort()
          .map(path => [path, readSkillResource(name, path)]),
      })
    )
    .digest('hex');
}

export function captureRuntimeCompatibility(
  promptKey: string,
  modelId: string,
  original?: RuntimeCompatibility
): RuntimeCompatibility {
  const definition = findRegisteredAgentDefinitionByPromptKey(promptKey);
  if (!definition) throw new Error(`Run agent unavailable: ${promptKey}`);
  const plugins = getRegisteredBackendPluginVersions();
  const modelIds = original
    ? Object.keys(original.models)
    : [...new Set([modelId, ...modelCatalog.getModelsByCapability('chat').map(model => model.id)])];
  const skillNames = original
    ? Object.keys(original.skills)
    : definition.config?.skill?.enabled
      ? getAllSkillMetadata()
          .filter(skill => !skill.disableModelInvocation && getSkillByName(skill.name))
          .map(skill => skill.name)
      : [];
  return {
    hostVersion,
    frameworkVersion: dependencies['@linnlabs/linnkit'],
    agentConfiguration: serializeConfiguration(definition.config ?? {}),
    models: Object.fromEntries(modelIds.map(id => [id, readModelBinding(id)])),
    plugins: (original
      ? original.plugins.map(required => {
          const installed = plugins.find(plugin => plugin.id === required.id);
          if (!installed) throw new Error(`Run plugin unavailable: ${required.id}`);
          return installed;
        })
      : plugins
    )
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id)),
    skills: Object.fromEntries(skillNames.map(name => [name, readSkillRevision(name)])),
  };
}

export function requireRuntimeCompatibility(descriptor: RunDescriptor): void {
  const modelId = descriptor.request.modelId ?? descriptor.request.model_id;
  if (!modelId) throw new Error('Run descriptor has no original model');
  const current = captureRuntimeCompatibility(
    descriptor.request.promptKey,
    modelId,
    descriptor.compatibility
  );
  if (!isDeepStrictEqual(current, descriptor.compatibility)) {
    throw new Error(
      'Original run capabilities changed; restore the original versions before continuing'
    );
  }
}
