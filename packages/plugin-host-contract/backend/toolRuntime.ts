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

export interface PluginSqliteTransactionPort {
  immediate(): void;
}

export interface PluginSqliteDatabasePort {
  prepare(sql: string): PluginSqliteStatementPort;
  exec(sql: string): unknown;
  transaction(fn: () => void): PluginSqliteTransactionPort;
}

export interface PluginKnowledgeBaseServicePort {
  getRawSoTDocument(docId: string): Promise<PluginDocumentSoT | null | undefined>;
  getDocumentById(docId: string): Promise<{ readonly filename?: string } | null | undefined>;
}

export interface PluginDocumentSoT {
  readonly content_blocks?: Readonly<Record<string, { readonly text?: string }>>;
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
  readonly knowledgeBaseService?: PluginKnowledgeBaseServicePort;
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
