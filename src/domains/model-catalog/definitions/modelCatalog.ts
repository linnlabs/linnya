/**
 * @file src/domains/model-catalog/definitions/modelCatalog.ts
 *
 * @description
 * Model Catalog 对外暴露的核心合同定义。
 */

import type { ModelReasoningConfig } from '@linnlabs/linnkit/contracts';
import type {
  InferenceApiSurface,
  InferenceAuthProfile,
  LanguageInferenceRouteProfileId,
  ModelEmbeddingRoute,
  ModelImageGenerationRoute,
  ModelInferenceRoute,
  ModelRerankingRoute,
} from '@app/schemas/model-inference';
import type { DocumentOcrRoute } from '@app/schemas/document-ocr';
import type { TranscriptionRoute } from '@app/schemas/transcription';
import type {
  CredentialReference,
  InferenceEndpointSelection,
  InferenceEndpointView,
  EndpointCredentialCodec,
} from './inferenceEndpoint';

export type {
  InferenceApiSurface,
  InferenceAuthProfile,
  ModelEmbeddingRoute,
  ModelImageGenerationRoute,
  ModelInferenceRoute,
  ModelRerankingRoute,
} from '@app/schemas/model-inference';
export type { DocumentOcrRoute } from '@app/schemas/document-ocr';
export type { TranscriptionRoute } from '@app/schemas/transcription';

export interface TokenRouteCapabilities {
  supportsRemoteTokenCount?: boolean;
  supportsResponseUsage?: boolean;
  supportsCachedInputBilling?: boolean;
  supportsReasoningTokens?: boolean;
}

/**
 * Token 计算路由。
 *
 * 中文备注：
 * - 同一个模型经官方、OpenRouter、硅基流动或 Linnya Cloud proxy 是不同 route；
 * - route 必须由配置显式声明或由 cloud catalog 显式生成，不能靠模型名猜计数能力。
 * - capabilityId 与 endpointModelId 都是 Host 侧不透明 identity，不表达 Provider 产品归属。
 */
export interface ModelTokenRoute {
  capabilityId: string;
  baseURL?: string;
  modelId: string;
  endpointModelId?: string;
  capabilities?: TokenRouteCapabilities;
}

/**
 * 已解析好的 token 单价，单位为 USD / 1M tokens。
 *
 * 阶梯、币种换算、优惠等复杂规则不在 registry 内计算；上游配置或 cloud catalog
 * 需要先解析为这里的有效单价，后续由 linnkit 的纯 computeCost 消费。
 */
export interface ModelTokenPricing {
  currency: 'USD';
  unit: 'per_1m_tokens';
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** 模型条目进入目录的事实来源，不表示用户购买或选择的 Provider。 */
export type ModelCatalogSource = 'default' | 'cloud' | 'account' | 'user';

/**
 * 模型配置接口
 *
 * @description 定义了一个完整的模型配置所需的所有字段
 */
export interface ModelConfig {
  /** 模型唯一标识符 */
  id: string;
  /** 模型名称 */
  model_name: string;
  /** 目录来源；推理协议与目标 endpoint 只读取 typed route。 */
  catalog_source: ModelCatalogSource;
  /** default/cloud/account 模型的显式凭据引用；用户模型使用 inference_endpoint_id。 */
  credential_reference?: CredentialReference;
  /** 用户模型绑定的内部推理 endpoint。 */
  inference_endpoint_id?: string;
  /** 模型能力列表 */
  capabilities: string[];
  /** UI 可见性设置 */
  ui_visibility: string[];
  /** 显示名称 */
  display_name: string;
  /** 模型描述 */
  description: string;
  /** Chat 推理路由；拥有 chat capability 的模型必须完整声明。 */
  inference_route?: ModelInferenceRoute;

  /** Embedding 推理路由；拥有 embedding capability 的模型必须完整声明。 */
  embedding_route?: ModelEmbeddingRoute;

  /** Reranking 推理路由；拥有 rerank capability 的模型必须完整声明。 */
  reranking_route?: ModelRerankingRoute;

  /** 图片生成路由；拥有 image_generation capability 的模型必须完整声明。 */
  image_generation_route?: ModelImageGenerationRoute;

  /** 专用文档 OCR 路由；拥有 document_ocr capability 的模型必须完整声明。 */
  document_ocr_route?: DocumentOcrRoute;

  /** 专用音频转写路由；拥有 audio_transcription capability 的模型必须完整声明。 */
  transcription_route?: TranscriptionRoute;

  /**
   * 计费模式（用于决定“客户端是否允许重试”等策略）。
   *
   * 中文备注：
   * - `byok`：用户自带 key，本地直连上游；
   * - `cloud`：走 Linnya Cloud（积分计费），建议客户端不做重试/降级，统一由服务端网关控制。
   */
  billing_mode?: 'byok' | 'cloud';

  /** 当前模型的 token accounting route；不配置则表示 host 尚未声明 route 能力。 */
  token_route?: ModelTokenRoute;

  /** 已解析为有效单价的 token price；缺失字段表示该分项价格 unknown。 */
  token_pricing?: ModelTokenPricing;

  /**
   * 是否允许客户端侧重试（默认 true；若 `billing_mode='cloud'` 且未显式配置，则建议视为 false）。
   *
   * 设计目的：
   * - 让“是否允许客户端重试”变成显式配置，而不是靠猜 route 地址/域名等脆弱规则；
   * - 避免 Cloud 模式下由于客户端重试导致的一次点击多次上游调用，从而破坏账单语义。
   */
  enable_client_retry?: boolean;

  /**
   * 图片生成相关约束（可选）
   *
   * 中文备注：
   * - 部分图片生成模型对 size 有更严格的约束（例如“最小像素数”）；
   * - 这些约束不应写死在工具或引擎里，应由模型配置驱动；
   * - 请求前必须完整校验，不允许依赖上游错误文本自动重试或修改用户尺寸。
   */
  image_generation?: {
    /** 最小像素数（width * height） */
    min_pixels?: number;
    /** 最大像素数（width * height） */
    max_pixels?: number;
    /**
     * 推荐/允许的尺寸列表（形如 "1920x1920"）
     * - 若配置，只有列表中的尺寸可以进入 Provider capability
     */
    allowed_sizes?: string[];
  };

  /**
   * 用户可见的 UI 标签（可选）。
   *
   * 纯展示用途：在模型列表/选择器中显示附加标识（如"限免"、"限额"、"新"等）。
   * 云端模型的 tags 来自 Cloud KV，本地模型的 tags 来自 default_models.json。
   *
   * 注意区分：
   * - `tags`：给用户看的 UI 标签，不影响程序逻辑
   * - `capabilities`：描述模型的功能角色，用于程序化选择（如 `embedding`、`rerank`）
   */
  tags?: string[];

  /**
   * 思考努力程度能力契约（可选）。
   *
   * 声明该模型支持哪些思考档位、默认档位、以及档位→原生参数的映射提示。
   * 经 `processModelConfig()` 白名单保留后，会随 `ModelConfig` 透出到前端（HTTP `GET /api/v1/models` 直传）。
   *
   * 设计要点：
   * - 模型是否「支持 reasoning」由 `reasoning.supported_efforts.length > 0` 推导，不单独加布尔；
   * - 字段定义与降级纯函数 `resolveEffectiveEffort()` 同源于 `linnkit/contracts`，前后端共用一处真源；
   * - 缺失表示该模型不支持思考努力程度控制，前端不展示控件、adapter 不发任何思考相关字段。
   *
   * 正式档位与降级合同由 `linnkit/contracts` 和 `reasoning-capabilities.ts` 共同维护。
   */
  reasoning?: ModelReasoningConfig;
}

/**
 * 模型差异对象
 *
 * @description 用于批量更新模型配置的差异描述
 */
export interface ModelDiff {
  /** 新增的模型 */
  added: ModelConfig[];
  /** 更新的模型 */
  updated: ModelConfig[];
  /** 删除的模型ID */
  removed: string[];
}

export type FunctionalModelDefaults = Record<string, string>;

/**
 * 模型注册表接口
 *
 * @description 定义了模型注册表的核心功能
 */
export interface ModelCatalog {
  /**
   * 获取所有模型
   * @returns 模型配置数组
   */
  getModels(): ModelConfig[];

  /**
   * 根据ID获取模型
   * @param id 模型ID
   * @returns 模型配置或undefined
   */
  getModel(id: string): ModelConfig | undefined;

  /** 返回 Host 推理投影必须保留的正式 route profile identity。 */
  getInferenceRouteProfileId(modelId: string): LanguageInferenceRouteProfileId | undefined;

  /** 解析一次调用所需凭据；目录 DTO 不返回明文。 */
  resolveCredential(modelId: string): string | undefined;

  /** 返回不含明文的 credential identity，供 Host auth boundary 选择凭据 owner。 */
  getCredentialReference(modelId: string): CredentialReference | undefined;

  /** 不解密，只报告当前进程能否解析该模型的凭据引用。 */
  hasCredential(modelId: string): boolean;

  /** 返回不含密文和明文的内部推理 endpoint read model。 */
  getInferenceEndpoints(): InferenceEndpointView[];

  /** 安装由 App composition 通过 Desktop Host capability 提供的系统安全存储 codec。 */
  installEndpointCredentialCodec(codec: EndpointCredentialCodec): void;

  /** 原子注册用户模型，并创建或复用一个内部推理 endpoint。 */
  registerUserModel(model: ModelConfig, endpoint: InferenceEndpointSelection): Promise<void>;

  /**
   * 原子替换一个 ProviderAccount 在当前进程投影出的模型。
   *
   * 账号模型不写入 Workspace；账号授权是其唯一 durable source，启动恢复时重新投影。
   */
  replaceAccountModels(accountId: string, models: readonly ModelConfig[]): void;

  /** 移除一个 ProviderAccount 在当前进程投影出的全部模型。 */
  removeAccountModels(accountId: string): void;

  /**
   * 添加模型
   * @param model 模型配置
   */
  addModel(model: ModelConfig): Promise<void>;

  /**
   * 更新模型
   * @param model 模型配置
   */
  updateModel(model: ModelConfig): Promise<void>;

  /**
   * 删除模型
   * @param id 模型ID
   */
  removeModel(id: string): Promise<void>;

  /**
   * 应用模型差异
   * @param diff 模型差异对象
   */
  applyDiff(diff: ModelDiff): Promise<void>;

  /**
   * 根据能力过滤模型
   * @param capability 能力名称
   * @returns 符合条件的模型配置数组
   */
  getModelsByCapability(capability: string): ModelConfig[];

  /**
   * 根据能力返回默认模型 ID
   * @param capability 能力名称
   * @returns 第一个启用的匹配模型 ID；无匹配时返回 undefined
   */
  getDefaultModelIdByCapability(capability: string): string | undefined;

  /**
   * 获取功能默认模型表。
   *
   * 返回值中的 model id 已经是客户端本地 Model Catalog ID（例如 cloud-deepseek-v4-flash），
   * 不再是云端原始模型名。
   */
  getFunctionalModelDefaults(): FunctionalModelDefaults;

  /**
   * 按功能键获取默认模型 ID。
   */
  getFunctionalDefaultModelId(purposeKey: string): string | undefined;

  /**
   * 当前进程内是否已成功拉取过云端模型列表。
   */
  areCloudModelsReady(): boolean;

  /** 当前进程内目录是否完成初始化。 */
  isInitialized(): boolean;

  /**
   * 初始化注册表
   * @param envVars 环境变量映射
   */
  initialize(envVars?: Record<string, string>): Promise<void>;
}
