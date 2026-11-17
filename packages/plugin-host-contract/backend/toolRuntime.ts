import type {
  ToolExecutionContext,
  ToolParameterProperty,
  ToolParameterSchema,
  ToolCallStreamingPolicy,
  StructuredToolResult,
  ToolResultImageMedia,
} from '@linnlabs/linnkit/runtime-kernel';
import type {
  PluginWorkspaceServicePort,
} from './workspaceRuntime';

export type {
  StructuredToolResult,
  ToolResultImageMedia,
  ToolParameterProperty,
  ToolParameterSchema,
  ToolCallStreamingPolicy,
} from '@linnlabs/linnkit/runtime-kernel';
export {
  BaseTool,
  CommonParameterTypes,
} from '@linnlabs/linnkit/runtime-kernel';
export type {
  PluginWorkspaceServicePort,
} from './workspaceRuntime';

export interface PluginDatabaseServicePort {
  getDb(): PluginSqliteDatabasePort;
}

export interface PluginSqliteStatementPort {
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown[];
  run(...params: readonly unknown[]): unknown;
}

export interface PluginSqliteTransactionPort<T = void> {
  immediate(): T;
}

export interface PluginSqliteDatabasePort {
  prepare(sql: string): PluginSqliteStatementPort;
  exec(sql: string): unknown;
  /** 与原生同步 SQLite 事务一致，保留回调结果；不接受异步事务回调。 */
  transaction<T>(fn: () => T): PluginSqliteTransactionPort<T>;
}

export interface PluginWorkspaceProjectMetadata {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string | null;
}

export interface PluginToolContext extends ToolExecutionContext {
  readonly databaseService?: PluginDatabaseServicePort;
  readonly workspaceService?: PluginWorkspaceServicePort;
  readonly workspaceProjectId?: string;
  readonly workspaceProjectMetadata?: PluginWorkspaceProjectMetadata;
}

export type PluginBaseToolConstructor = new () => {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameterSchema;
  /**
   * 通用的 LLM tool-call 生命周期发布策略。
   * 插件只声明 runtime 行为，不携带 Renderer 或产品语义。
   */
  readonly streaming?: ToolCallStreamingPolicy;
  run(args: Record<string, unknown>, context: PluginToolContext): Promise<string>;
  validateArguments?(args: Record<string, unknown>): { success: true } | { success: false; error?: string };
  getExecutionSummary?(output: string): string;
};

export type PluginStructuredToolResult<T = unknown> = StructuredToolResult<T>;
export type ToolContext = PluginToolContext;

/** 来源正文仅作资料；复用 Host 动态边界，不让插件复制 token/转义规则。 */
export declare function createUntrustedContentBoundaryToken(seed: string): string;
export declare function wrapUntrustedContentBoundary(params: {
  readonly namespace: string;
  readonly token: string;
  readonly body: string;
}): string[];

export interface RunRegisteredSubagentParams {
  readonly context: PluginToolContext;
  readonly promptKey: string;
  readonly description: string;
  readonly userMessage: string;
  readonly inheritTurns: number;
  readonly maxSteps: number;
  readonly subrunSource: string;
  readonly subrunMetadata: Record<string, unknown>;
  readonly subrunId?: string;
}

export interface RunRegisteredSubagentResult {
  readonly runId?: string;
  readonly parentRunId?: string;
  readonly subrunId: string;
  readonly success: boolean;
  readonly cancelled?: boolean;
  readonly finalAnswer: string;
  readonly lastProgress?: string;
  readonly error?: string;
  /** 子运行最终工具的真实结构化结果；Host runner 已接纳，插件不能从历史猜测。 */
  readonly judgeToolOutput?: string;
}

export interface RunRegisteredSubagentsInParallelParams {
  readonly context: PluginToolContext;
  readonly subruns: Array<Omit<RunRegisteredSubagentParams, 'context'>>;
  readonly maxConcurrency?: number;
}

export declare function runRegisteredSubagent(
  params: RunRegisteredSubagentParams,
): Promise<RunRegisteredSubagentResult>;
export declare function runRegisteredSubagentsInParallel(
  params: RunRegisteredSubagentsInParallelParams,
): Promise<RunRegisteredSubagentResult[]>;
