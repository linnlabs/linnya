import {
  AI_SDK_INFERENCE_CAPABILITY_IDS,
  type AiSdkInferenceCapabilityId,
} from '../../src/definitions/aiSdkCapabilityIds';

export const PROVIDER_CONFORMANCE_SUITE_VERSION = '1.0.0';

type ProviderConformanceTestFile = `conformance/providers/${string}.test.ts`;

const CONTEXT_COMPACTION_CONFORMANCE_FILE =
  'conformance/providers/contextCompactionRequestCodec.integration.test.ts' satisfies ProviderConformanceTestFile;

const CAPABILITY_CONFORMANCE_FILES = {
  [AI_SDK_INFERENCE_CAPABILITY_IDS.OPENAI_CHAT]: [
    'conformance/providers/openAiChatCapability.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.OPENAI_COMPATIBLE_CHAT]: [
    'conformance/providers/openAiChatCapability.integration.test.ts',
    'conformance/providers/compatibleProviderCodecs.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.OPENAI_RESPONSES]: [
    'conformance/providers/chatGptCodexProviderCodec.integration.test.ts',
    'conformance/providers/openAiResponsesCodec.integration.test.ts',
    'conformance/providers/providerContinuationRoundTrip.integration.test.ts',
    'conformance/providers/providerSurfaceCodecs.integration.test.ts',
    'conformance/providers/streamReliability.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.ANTHROPIC_MESSAGES]: [
    'conformance/providers/anthropicMessagesCodec.integration.test.ts',
    'conformance/providers/providerContinuationRoundTrip.integration.test.ts',
    'conformance/providers/providerSurfaceCodecs.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.GOOGLE_GENERATIVE_AI]: [
    'conformance/providers/googleGenerativeAiCodec.integration.test.ts',
    'conformance/providers/providerContinuationRoundTrip.integration.test.ts',
    'conformance/providers/providerSurfaceCodecs.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.DEEPSEEK_CHAT]: [
    'conformance/providers/deepSeekProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.MINIMAX_CHAT]: [
    'conformance/providers/miniMaxProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.MOONSHOT_CHAT]: [
    'conformance/providers/moonshotAlibabaProviderCodecs.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.ALIBABA_CHAT]: [
    'conformance/providers/moonshotAlibabaProviderCodecs.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.MISTRAL_CHAT]: [
    'conformance/providers/mistralProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.XAI_RESPONSES]: [
    'conformance/providers/xAiProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.GROQ_CHAT]: [
    'conformance/providers/groqProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.CEREBRAS_CHAT]: [
    'conformance/providers/cerebrasProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.OPENROUTER_CHAT]: [
    'conformance/providers/openRouterProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.FIREWORKS_CHAT]: [
    'conformance/providers/fireworksProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.TOGETHERAI_CHAT]: [
    'conformance/providers/togetherAiProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.DEEPINFRA_CHAT]: [
    'conformance/providers/deepInfraProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.COHERE_CHAT]: [
    'conformance/providers/cohereProviderCodec.integration.test.ts',
  ],
  [AI_SDK_INFERENCE_CAPABILITY_IDS.ZAI_CHAT]: [
    'conformance/providers/zaiProviderCodec.integration.test.ts',
  ],
} satisfies Record<AiSdkInferenceCapabilityId, readonly ProviderConformanceTestFile[]>;

const CORE_PACKAGES = new Set(['ai', '@ai-sdk/provider']);

export interface ProviderConformanceFactoryDescriptor {
  readonly capability_id: AiSdkInferenceCapabilityId;
  readonly package_name: string;
  readonly package_version: string;
}

export interface ProviderConformanceSelectionInput {
  readonly factories: readonly ProviderConformanceFactoryDescriptor[];
  readonly capability_ids?: readonly string[];
  readonly package_names?: readonly string[];
  readonly all?: boolean;
}

export interface ProviderConformanceSelection {
  readonly suite_version: string;
  readonly capability_ids: readonly AiSdkInferenceCapabilityId[];
  readonly test_files: readonly ProviderConformanceTestFile[];
  readonly provider_packages: readonly {
    readonly package_name: string;
    readonly package_version: string;
  }[];
}

function isAiSdkInferenceCapabilityId(value: string): value is AiSdkInferenceCapabilityId {
  return Object.values(AI_SDK_INFERENCE_CAPABILITY_IDS).some(candidate => candidate === value);
}

export function selectAffectedProviderConformance(
  input: ProviderConformanceSelectionInput
): ProviderConformanceSelection {
  const knownPackageNames = new Set(input.factories.map(factory => factory.package_name));
  const requestedPackageNames = input.package_names ?? [];
  const unknownPackageNames = requestedPackageNames.filter(
    packageName => !CORE_PACKAGES.has(packageName) && !knownPackageNames.has(packageName)
  );
  if (unknownPackageNames.length > 0) {
    throw new Error(`未注册的 Provider package: ${unknownPackageNames.join(', ')}`);
  }

  const requestedCapabilityIds = input.capability_ids ?? [];
  const unknownCapabilityIds = requestedCapabilityIds.filter(
    capabilityId => !isAiSdkInferenceCapabilityId(capabilityId)
  );
  if (unknownCapabilityIds.length > 0) {
    throw new Error(`未注册的 inference capability: ${unknownCapabilityIds.join(', ')}`);
  }

  const selectAll =
    input.all === true || requestedPackageNames.some(packageName => CORE_PACKAGES.has(packageName));
  const selectedCapabilityIds = new Set<AiSdkInferenceCapabilityId>();
  if (selectAll) {
    for (const capabilityId of Object.values(AI_SDK_INFERENCE_CAPABILITY_IDS)) {
      selectedCapabilityIds.add(capabilityId);
    }
  } else {
    for (const capabilityId of requestedCapabilityIds) {
      if (isAiSdkInferenceCapabilityId(capabilityId)) selectedCapabilityIds.add(capabilityId);
    }
    for (const factory of input.factories) {
      if (requestedPackageNames.includes(factory.package_name)) {
        selectedCapabilityIds.add(factory.capability_id);
      }
    }
  }

  if (selectedCapabilityIds.size === 0) {
    throw new Error('必须指定 --capability、--package 或 --all。');
  }

  const selectedFactories = input.factories.filter(factory =>
    selectedCapabilityIds.has(factory.capability_id)
  );
  const providerPackages = new Map<string, string>();
  for (const factory of selectedFactories) {
    const currentVersion = providerPackages.get(factory.package_name);
    if (currentVersion !== undefined && currentVersion !== factory.package_version) {
      throw new Error(`${factory.package_name} 在 registry 中出现多个版本。`);
    }
    providerPackages.set(factory.package_name, factory.package_version);
  }

  // 统一 compaction 请求横跨所有正式 codec；任一 capability 变化都必须重跑这组语义矩阵。
  const testFiles = new Set<ProviderConformanceTestFile>([CONTEXT_COMPACTION_CONFORMANCE_FILE]);
  for (const capabilityId of selectedCapabilityIds) {
    for (const testFile of CAPABILITY_CONFORMANCE_FILES[capabilityId]) testFiles.add(testFile);
  }

  return {
    suite_version: PROVIDER_CONFORMANCE_SUITE_VERSION,
    capability_ids: [...selectedCapabilityIds].sort(),
    test_files: [...testFiles].sort(),
    provider_packages: [...providerPackages]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([package_name, package_version]) => ({ package_name, package_version })),
  };
}
