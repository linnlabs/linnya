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
  readSkillResourceForDigest,
} from 'src/features/skills/catalog';
import {
  SKILL_AUTHORING_SKILL,
  toolListGrantsSkillAuthoring,
} from 'src/features/skills/functions/canAuthorSkills';
import { findRegisteredAgentDefinitionByPromptKey } from '../../../agent-registry/agentDefinitionResolver';
import { getRegisteredBackendPluginVersions } from '../../../plugin-registry/builtin';
import type { RunDescriptor } from '../definitions/runDescriptor';
import { runCompletesWithoutModel } from './runCompletesWithoutModel';

type RuntimeCompatibility = RunDescriptor['compatibility'];

export class RunModelBindingUnavailableError extends Error {
  constructor(readonly modelId: string, kind: 'model' | 'endpoint') {
    super(`Run ${kind} unavailable: ${modelId}`);
    this.name = 'RunModelBindingUnavailableError';
  }
}

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
  if (!model) throw new RunModelBindingUnavailableError(modelId, 'model');
  const endpoint = model.inference_endpoint_id
    ? modelCatalog.getInferenceEndpoints().find(item => item.id === model.inference_endpoint_id)
    : undefined;
  if (model.inference_endpoint_id && !endpoint)
    throw new RunModelBindingUnavailableError(modelId, 'endpoint');
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
          .map(path => [path, readSkillResourceForDigest(name, path)]),
      })
    )
    .digest('hex');
}

/**
 * `modelId` 是本次运行绑定的模型；不请求模型的运行（见 `runCompletesWithoutModel`）没有绑定模型，
 * 传 `undefined`，兼容性里只记录当时目录中的聊天模型。
 */
export function captureRuntimeCompatibility(
  promptKey: string,
  modelId: string | undefined,
  descriptor?: RunDescriptor
): RuntimeCompatibility {
  const definition = findRegisteredAgentDefinitionByPromptKey(promptKey);
  if (!definition) throw new Error(`Run agent unavailable: ${promptKey}`);
  const original = descriptor?.compatibility;
  const plugins = getRegisteredBackendPluginVersions();
  const modelIds = original
    ? Object.keys(original.models)
    : [...new Set([
        ...(modelId === undefined ? [] : [modelId]),
        ...modelCatalog.getModelsByCapability('chat').map(model => model.id),
      ])];
  const skillNames = original
    ? Object.keys(original.skills)
    : definition.config?.skill?.enabled
      ? getAllSkillMetadata()
          .filter(skill => !skill.disableModelInvocation && getSkillByName(skill.name)
            && (skill.name !== SKILL_AUTHORING_SKILL
              || toolListGrantsSkillAuthoring(definition.config?.availableTools)))
          .map(skill => skill.name)
      : [];
  return {
    hostVersion,
    frameworkVersion: dependencies['@linnlabs/linnkit'],
    // 撤回的研究交接协议不再伪装成可执行的历史配置；差异按通用恢复合同报告。
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
  // 只有不请求模型的运行可以没有原模型；其余描述缺模型说明记录损坏，不能续跑。
  if (!modelId && !runCompletesWithoutModel(descriptor.options)) {
    throw new Error('Run descriptor has no original model');
  }
  const current = captureRuntimeCompatibility(descriptor.request.promptKey, modelId, descriptor);
  if (!isDeepStrictEqual(current, descriptor.compatibility)) {
    throw new Error(
      'Original run capabilities changed; restore the original versions before continuing'
    );
  }
}
