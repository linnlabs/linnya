/**
 * @file src/tools/types.ts
 *
 * @brief 定义 Agent 工具的统一接口和类型系统
 *
 * @description
 * 此文件定义了所有 Agent 工具必须遵循的标准合同，包括工具的元数据描述、
 * 参数验证和执行接口。这个设计受到了 OpenAI Function Calling 和
 * FastMCP 的启发，确保工具的一致性和可扩展性。
 */

import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import type { KnowledgeBaseService } from '../features/knowledge-base/application/knowledgeBaseService';
import type {
  GraphBudget,
  GraphMode,
} from '../features/knowledge-base/graph/application/graphBudget';
export type { ToolContextConversationView } from '@linnlabs/linnkit/runtime-kernel';
export type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
export { BaseTool, CommonParameterTypes } from '@linnlabs/linnkit/runtime-kernel';
export type {
  StructuredToolResult,
  ToolControlInfo,
  ToolObservationPreviewMeta,
  ToolResultImageMedia,
} from '@linnlabs/linnkit/runtime-kernel';
export type {
  ToolParameterProperty,
  ToolParameterSchema,
  ToolParameterType,
  ToolArgs,
  JsonSchemaValue,
  ToolResult,
  UnifiedToolResult,
  ToolRegistryEntry,
  AgentTool,
  FunctionToolSchema,
  ToolCallResult,
  ToolCallStreamingPolicy,
} from '@linnlabs/linnkit/runtime-kernel';
export type {
  ToolExecutionResult,
  ToolRuntimeDefinition,
  ToolRuntimePort,
  ToolSchemaBuildRequest,
} from '@linnlabs/linnkit/runtime-kernel';

/**
 * 工具执行上下文
 * 包含工具执行时需要的所有依赖和配置
 */
export interface ToolContext extends ToolExecutionContext {
  /** 当前 activation 的结果提交窄端口；不能从最新 run 状态反查并补猜身份。 */
  toolResultReceipts?: import('../app-hosts/linnya/application/run-resumption').ToolResultReceiptPort;
  /** 会话工作目录 admission；生成图片必须直接写入受管 conversation-scoped 目录。 */
  conversationWorkDirectoryAdmission?: import('../app-hosts/linnya/application/conversation-lifecycle').ConversationWorkDirectoryAdmissionPort;
  /** Host 注入的受管图片入口；工具结果图片通过它登记为 durable asset。 */
  managedImageIngress?: import('../domains/assets/features/managed-image-ingress').ManagedImageIngressPort;
  /** Host 注入的工具结果 claim registry；声明图片如何回流模型输入。 */
  toolResultAssetClaims?: import('../domains/assets/features/tool-result-claims').ToolResultAssetClaimRegistryPort;
  /** Host 注入的普通物理文件读取端口；read_file 不直接访问 Node 文件系统。 */
  physicalFileReader?: import('../app-hosts/linnya/application/file-read').PhysicalFileReaderPort;

  /** 根 run 启动时冻结；child run 继承，工具执行期间禁止重新读取全局设置。 */
  commandRunPermission?: import('../domains/commands/features/permission-settings').CommandRunPermissionContext;

  /** 由 Linnya host 注入的 Shell/process 用例；工具不能取得底层 owner 或 runner。 */
  shellToolRuntime?: import('../app-hosts/linnya/adapters/commands/shell-runtime/definitions').ShellToolRuntimePort;

  /**
   * 🔥 Deep Research 上下文（Phase 3 / Milestone 4）
   *
   * 设计目标：
   * - 承载 Deep Research 的实例隔离键（instanceId）；
   * - 替代旧的 workflowKey/workflowInstanceId；
   * - 必须由编排层在 run 启动时注入，工具层只读。
   */
  research?: {
    instanceId: string;
  };

  /** 知识库服务实例 */
  knowledgeBaseService?: KnowledgeBaseService;
  /** 搜索服务实例 */
  searchService?: unknown;
  /** 嵌入模型ID */
  embeddingModelId?: string;
  /** 重排序模型ID */
  rerankModelId?: string;
  /** 图片生成模型ID */
  imageGenerationModelId?: string;
  /** 当前 Workspace 项目 ID（由前端 / 编排器注入，AI 无需手动传参） */
  workspaceProjectId?: string;
  /** 当前 Workspace 项目的人类可读元信息 */
  workspaceProjectMetadata?: {
    id?: string;
    name?: string;
    description?: string | null;
  };
  /** 工作区数据库服务实例 */
  databaseService?: import('../electron-main/services/database').DatabaseService;
  /** 工作区节点树服务实例 */
  workspaceService?: import('../electron-main/services/workspace/workspace').WorkspaceService;
  /** Workspace mutation 发布端口：工具写入真实 workspace 事实后用于通知 renderer 刷新。 */
  workspaceMutationPublisher?: import('../features/workspace/definitions/workspaceMutationPublisher').WorkspaceMutationPublisher;
  /**
   * 知识库图谱增强策略注入。
   *
   * 中文说明：
   * - 这是业务/编排层给搜索工具的确定性策略，不是模型参数；
   * - 显式列在 ToolContext 上，避免继续依赖 `[key:string]` 读取任意字段。
   */
  graphMode?: GraphMode;
  graphBudget?: Partial<GraphBudget>;
}

/**
 * 工具幂等策略（Phase 3）
 *
 * 中文备注：
 * - 用于防止“同一会话内重试”导致的重复副作用；
 * - 只建议在“写入型工具”启用；read-only 工具默认不启用，避免误去重造成结果不新鲜。
 */
export type ToolIdempotencyScope = 'conversation' | 'turn';
export type ToolIdempotencyPolicy = { scope: ToolIdempotencyScope };

/**
 * Linnya concrete tools 构建请求级动态 Schema 时可读取的最小产品上下文。
 *
 * 该合同不进入 Linnkit，也不包含 query/history；新增字段必须有具体工具消费者，
 * 避免把完整 Agent 请求或任意 metadata 暴露给工具注册表中的所有工具。
 */
export type LinnyaToolSchemaContext = Readonly<Pick<ToolContext, 'imageGenerationModelId'>>;
