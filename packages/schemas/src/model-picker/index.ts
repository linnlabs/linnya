import { z } from 'zod';
import { CustomApiFormatSchema, CustomCapabilityApiFormatSchema } from '../custom-api-onboarding';

const NonEmptyStringSchema = z.string().trim().min(1);
const ReasoningEffortSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const CredentialUnavailableReasonSchema = z.literal('missing');

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
    activation_unavailable_reason: NonEmptyStringSchema.optional(),
    provider_model_id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema,
    picker_enabled: z.literal(false),
    runtime_available: z.literal(false),
    capabilities: z.array(NonEmptyStringSchema).min(1),
    image_input: z.boolean(),
  })
  .strict();

/**
 * 用户模型启动时没有通过准入的原因类别，由 Model Catalog 在抛错处给出。
 * 界面按类别显示白话说明，原文只作悬停详情；不能反过来从原文猜类别。
 */
export const UnadmittedModelReasonKindSchema = z.enum([
  /** 一个条目同时声明了多种调用方式（旧版编辑接口写出的双 route）。 */
  'multiple_routes',
  /** 调用方式与所引用连接的协议、地址或鉴权不一致。 */
  'route_endpoint_mismatch',
  /** 没有引用连接，或引用的连接不在文件里。 */
  'endpoint_missing',
  /** 调用方式字段缺失、格式不对或模型名对不上。 */
  'invalid_route',
  /** 旧版明文 Key 字段或冲突的凭据声明。 */
  'credential_declaration',
  /** 条目本身的结构不对（多为手改文件）。 */
  'invalid_structure',
  /** 检查过程本身出错，不是已知的配置问题；原文用于反馈。 */
  'unexpected',
]);

/**
 * 启动时没有通过准入而停用的用户模型：不在运行目录里、不能选择，只能删除或（正式 Provider 成员）按定义修复。
 * `reason` 是后端原文，只用于悬停详情和反馈问题。
 */
export const ModelPickerUnadmittedModelSchema = z
  .object({
    model_config_id: NonEmptyStringSchema,
    display_name: NonEmptyStringSchema,
    reason_kind: UnadmittedModelReasonKindSchema,
    reason: NonEmptyStringSchema,
    /** 只有正式 Provider 成员、且 Provider 当前定义里仍有这个模型时为 true。 */
    repairable: z.boolean(),
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
    can_refresh_models: z.boolean(),
    kind: z.enum(['direct', 'local_runtime']),
    /** connection setup 决定的凭据形态；只有 `api_key` 允许在模型管理中更换密钥。 */
    credential_kind: z.enum(['api_key', 'provider_account', 'none']),
    picker_enabled: z.boolean(),
    credential_available: z.boolean(),
    credential_unavailable_reason: CredentialUnavailableReasonSchema.optional(),
    models: z.array(ModelPickerProviderModelSchema),
    unadmitted_models: z.array(ModelPickerUnadmittedModelSchema),
  })
  .strict();


export const ModelPickerCustomProviderGroupSchema = z
  .object({
    provider_id: NonEmptyStringSchema,
    provider_name: NonEmptyStringSchema,
    api_format: CustomApiFormatSchema.optional(),
    capability_api_format: CustomCapabilityApiFormatSchema.optional(),
    base_url: z.string().optional(),
    endpoint_id: z.string().optional(),
    models: z.array(ModelPickerMaterializedModelSchema),
    unadmitted_models: z.array(ModelPickerUnadmittedModelSchema),
  })
  .strict();

export type ModelPickerCustomProviderGroup = z.infer<typeof ModelPickerCustomProviderGroupSchema>;

/** Settings 和对话入口共同消费的 Host 投影；前端不自行猜 Provider 归属。 */
export const ModelPickerSnapshotSchema = z
  .object({
    providers: z.array(ModelPickerConfiguredProviderSchema),
    custom_models: z.array(ModelPickerMaterializedModelSchema),
    custom_providers: z.array(ModelPickerCustomProviderGroupSchema).optional(),
    /** 归属已不存在的停用条目（多为旧版删除分组时留下的），只能删除。 */
    unassigned_unadmitted_models: z.array(ModelPickerUnadmittedModelSchema),
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
export type UnadmittedModelReasonKind = z.infer<typeof UnadmittedModelReasonKindSchema>;
export type ModelPickerUnadmittedModel = z.infer<typeof ModelPickerUnadmittedModelSchema>;
export type ModelPickerProviderModel = z.infer<typeof ModelPickerProviderModelSchema>;
export type ModelPickerConfiguredProvider = z.infer<typeof ModelPickerConfiguredProviderSchema>;
export type ModelPickerCredentialUnavailableReason = z.infer<
  typeof CredentialUnavailableReasonSchema
>;
export type ModelPickerSnapshot = z.infer<typeof ModelPickerSnapshotSchema>;
export type SetModelPickerProviderVisibilityCommand = z.infer<
  typeof SetModelPickerProviderVisibilityCommandSchema
>;
export type SetModelPickerModelVisibilityCommand = z.infer<
  typeof SetModelPickerModelVisibilityCommandSchema
>;
