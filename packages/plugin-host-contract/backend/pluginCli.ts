export interface BackendPluginCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 当前 App bridge v1 不开放外部文件、任意网络、GUI 或通用本地 IPC。 */
export interface BackendPluginCliAccessPlan {
  readonly internalDataAccess: 'none' | 'required';
  readonly conversationFiles: 'none' | 'write';
  readonly externalFiles: 'denied';
  readonly network: 'denied';
  readonly guiControl: 'denied';
  readonly localIpcControl: 'denied';
}

export interface BackendPluginCliExecutionContext {
  /** 只有父 Shell 权限门禁通过后才提供；插件必须在 execute 内按自身窄类型读取。 */
  readonly hostContext: unknown;
  readonly signal: AbortSignal;
}

export interface BackendPluginCliPlan {
  readonly access: BackendPluginCliAccessPlan;
  execute(context: BackendPluginCliExecutionContext): Promise<BackendPluginCliResult>;
}

export type BackendPluginCliPreparation =
  | { readonly status: 'ready'; readonly plan: BackendPluginCliPlan }
  | { readonly status: 'completed'; readonly result: BackendPluginCliResult };

/**
 * 插件贡献的是 CLI 领域能力，不是 Agent 工具或 transport。argv、parser、exit code 与
 * stdout/stderr 语义归插件；当前 App bridge 和 standalone command mode 只是两个宿主 adapter。
 */
export interface BackendPluginCliContribution {
  prepare(input: {
    readonly argv: readonly string[];
    readonly invocationId: string;
    readonly conversationRoot: string;
  }): BackendPluginCliPreparation;
}
