import { z } from 'zod';

const PositiveSafeIntegerSchema = z.number().int().positive().safe();
const NonEmptyStringSchema = z.string().trim().min(1);

export const ProviderModelDefinitionSchema = z
  .object({
    id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema,
    release_status: z.enum(['active', 'preview']),
    context_window_tokens: PositiveSafeIntegerSchema,
    max_input_tokens: PositiveSafeIntegerSchema,
    max_output_tokens: PositiveSafeIntegerSchema,
    capabilities: z
      .object({ image_input: z.boolean(), tool_call: z.boolean(), reasoning: z.boolean() })
      .strict(),
    family: NonEmptyStringSchema.optional(),
    release_date: NonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((model, context) => {
    if (model.max_input_tokens > model.context_window_tokens) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'max_input_tokens 不能超过 context_window_tokens',
      });
    }
  });

export const ProviderSetupFieldSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: z.literal('api_key'),
      kind: z.literal('secret'),
      required: z.literal(true),
      label: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      id: z.literal('service_url'),
      kind: z.literal('url'),
      required: z.literal(true),
      label: NonEmptyStringSchema,
      default_value: z.string().url(),
    })
    .strict(),
  z
    .object({
      id: z.literal('authorization'),
      kind: z.literal('oauth'),
      required: z.literal(true),
      label: NonEmptyStringSchema,
    })
    .strict(),
]);

export const ProviderConnectionDefinitionSchema = z
  .object({
    id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema,
    description: NonEmptyStringSchema.optional(),
    badge: NonEmptyStringSchema.optional(),
    setup_help_url: z.string().url().optional(),
    kind: z.enum(['direct', 'cloud', 'local_runtime']),
    release_status: z.enum(['stable', 'preview', 'hidden']),
    setup_fields: z.array(ProviderSetupFieldSchema),
    model_discovery: z.enum(['bundled', 'account_catalog', 'cloud_catalog', 'local_runtime']),
    models: z.array(ProviderModelDefinitionSchema),
  })
  .strict();

export const ProviderDefinitionSchema = z
  .object({
    id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema,
    connections: z.array(ProviderConnectionDefinitionSchema).min(1),
  })
  .strict();

export const ProviderCatalogGenerationSchema = z
  .object({
    id: NonEmptyStringSchema,
    source_url: z.string().url(),
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    synced_at: z.string().datetime(),
    policy_version: PositiveSafeIntegerSchema,
  })
  .strict();

export const ProviderCatalogSnapshotSchema = z
  .object({
    schema_version: z.literal(2),
    generation: ProviderCatalogGenerationSchema,
    providers: z.array(ProviderDefinitionSchema),
  })
  .strict();

export const ProviderCatalogListResponseSchema = z
  .object({
    generation: ProviderCatalogGenerationSchema,
    providers: z.array(ProviderDefinitionSchema),
    total: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.total !== response.providers.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'total 必须等于 providers.length',
      });
    }
  });

export const ProviderCatalogGetResponseSchema = z
  .object({
    generation: ProviderCatalogGenerationSchema,
    provider: ProviderDefinitionSchema,
  })
  .strict();

export type ProviderModelDefinition = z.infer<typeof ProviderModelDefinitionSchema>;
export type ProviderModelCapabilities = ProviderModelDefinition['capabilities'];
export type ProviderModelReleaseStatus = ProviderModelDefinition['release_status'];
export type ProviderSetupField = z.infer<typeof ProviderSetupFieldSchema>;
export type ProviderConnectionDefinition = z.infer<typeof ProviderConnectionDefinitionSchema>;
export type ProviderDefinition = z.infer<typeof ProviderDefinitionSchema>;
export type ProviderConnectionKind = ProviderConnectionDefinition['kind'];
export type ProviderConnectionReleaseStatus = ProviderConnectionDefinition['release_status'];
export type ProviderModelDiscoveryKind = ProviderConnectionDefinition['model_discovery'];
/** @deprecated 新代码使用 ProviderConnectionKind；保留类型别名避免无关 domain 重命名。 */
export type ProviderKind = ProviderConnectionKind;
/** @deprecated 新代码使用 ProviderConnectionReleaseStatus。 */
export type ProviderReleaseStatus = ProviderConnectionReleaseStatus;
export type ProviderCatalogGeneration = z.infer<typeof ProviderCatalogGenerationSchema>;
export type ProviderCatalogSnapshot = z.infer<typeof ProviderCatalogSnapshotSchema>;
export type ProviderCatalogListResponse = z.infer<typeof ProviderCatalogListResponseSchema>;
export type ProviderCatalogGetResponse = z.infer<typeof ProviderCatalogGetResponseSchema>;

export interface LegacyProviderConnectionIdentity {
  readonly provider_definition_id: string;
  readonly provider_connection_definition_id: string;
}

/**
 * Provider Catalog v1 的一级产品 ID 到 v2 品牌/connection 的一次性迁移合同。
 * 未发生品牌归并的旧 ID 保持同名 connection，禁止根据 URL、Key 或模型名猜测。
 */
export function projectLegacyProviderConnectionIdentity(
  legacyProviderDefinitionId: string
): LegacyProviderConnectionIdentity {
  switch (legacyProviderDefinitionId) {
    case 'openai':
      return {
        provider_definition_id: 'openai',
        provider_connection_definition_id: 'openai-api',
      };
    case 'chatgpt':
      return {
        provider_definition_id: 'openai',
        provider_connection_definition_id: 'openai-chatgpt-subscription',
      };
    case 'moonshot':
      return {
        provider_definition_id: 'moonshot',
        provider_connection_definition_id: 'moonshot-api-global',
      };
    case 'zai':
      return {
        provider_definition_id: 'zai',
        provider_connection_definition_id: 'zai-api-global',
      };
    default:
      return {
        provider_definition_id: legacyProviderDefinitionId,
        provider_connection_definition_id: legacyProviderDefinitionId,
      };
  }
}
