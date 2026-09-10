import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);
const ReasoningEffortSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const CredentialUnavailableReasonSchema = z.enum([
  'missing',
  'temporarily_unavailable',
  'invalidated',
  'malformed_ciphertext',
  'unknown',
]);

export const ModelPickerReasoningSchema = z
  .object({
    supported_efforts: z.array(ReasoningEffortSchema).min(1),
    default_effort: ReasoningEffortSchema.optional(),
  })
  .strict();

/** 已经存在本地 ModelConfig，可被快捷选择器引用的模型事实。 */
export const ModelPickerMaterializedModelSchema = z
  .object({
    materialized: z.literal(true),
    model_config_id: NonEmptyStringSchema,
    provider_model_id: NonEmptyStringSchema.optional(),
    display_name: NonEmptyStringSchema,
    picker_enabled: z.boolean(),
    runtime_available: z.boolean(),
    capabilities: z.array(NonEmptyStringSchema).min(1),
    image_input: z.boolean(),
    reasoning: ModelPickerReasoningSchema.optional(),
  })
  .strict();

/** 正式 Provider 目录中尚未激活、因此不能进入快捷选择器的模型事实。 */
export const ModelPickerUnmaterializedModelSchema = z
  .object({
    materialized: z.literal(false),
    provider_model_id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema,
    picker_enabled: z.literal(false),
    runtime_available: z.literal(false),
    capabilities: z.array(NonEmptyStringSchema).min(1),
    image_input: z.boolean(),
  })
  .strict();

export const ModelPickerProviderModelSchema = z.discriminatedUnion('materialized', [
  ModelPickerMaterializedModelSchema,
  ModelPickerUnmaterializedModelSchema,
]);

export const ModelPickerConfiguredProviderSchema = z
  .object({
    configured_provider_id: NonEmptyStringSchema,
    provider_definition_id: NonEmptyStringSchema,
    provider_connection_definition_id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema,
    connection_display_name: NonEmptyStringSchema,
    kind: z.enum(['direct', 'local_runtime']),
    picker_enabled: z.boolean(),
    credential_available: z.boolean(),
    credential_unavailable_reason: CredentialUnavailableReasonSchema.optional(),
    models: z.array(ModelPickerProviderModelSchema),
  })
  .strict();

export const ModelPickerDirectGroupSchema = z
  .object({
    display_name: NonEmptyStringSchema,
    models: z.array(ModelPickerMaterializedModelSchema),
  })
  .strict();

export const ModelPickerCustomProviderGroupSchema = z
  .object({
    provider_id: NonEmptyStringSchema,
    provider_name: NonEmptyStringSchema,
    api_format: z.string().optional(),
    base_url: z.string().optional(),
    endpoint_id: z.string().optional(),
    models: z.array(ModelPickerMaterializedModelSchema),
  })
  .strict();

export type ModelPickerCustomProviderGroup = z.infer<
  typeof ModelPickerCustomProviderGroupSchema
>;

/** Settings 和对话入口共同消费的 Host 投影；前端不自行猜 Provider 归属。 */
export const ModelPickerSnapshotSchema = z
  .object({
    cloud: ModelPickerDirectGroupSchema.optional(),
    providers: z.array(ModelPickerConfiguredProviderSchema),
    custom_models: z.array(ModelPickerMaterializedModelSchema),
    custom_providers: z.array(ModelPickerCustomProviderGroupSchema).optional(),
  })
  .strict();

export const SetModelPickerProviderVisibilityCommandSchema = z
  .object({ visible: z.boolean() })
  .strict();

export const SetModelPickerModelVisibilityCommandSchema = z
  .object({ visible: z.boolean() })
  .strict();

export type ModelPickerReasoning = z.infer<typeof ModelPickerReasoningSchema>;
export type ModelPickerMaterializedModel = z.infer<typeof ModelPickerMaterializedModelSchema>;
export type ModelPickerUnmaterializedModel = z.infer<typeof ModelPickerUnmaterializedModelSchema>;
export type ModelPickerProviderModel = z.infer<typeof ModelPickerProviderModelSchema>;
export type ModelPickerConfiguredProvider = z.infer<typeof ModelPickerConfiguredProviderSchema>;
export type ModelPickerCredentialUnavailableReason = z.infer<
  typeof CredentialUnavailableReasonSchema
>;
export type ModelPickerDirectGroup = z.infer<typeof ModelPickerDirectGroupSchema>;
export type ModelPickerSnapshot = z.infer<typeof ModelPickerSnapshotSchema>;
export type SetModelPickerProviderVisibilityCommand = z.infer<
  typeof SetModelPickerProviderVisibilityCommandSchema
>;
export type SetModelPickerModelVisibilityCommand = z.infer<
  typeof SetModelPickerModelVisibilityCommandSchema
>;
