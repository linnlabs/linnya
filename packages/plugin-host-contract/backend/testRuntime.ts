/**
 * 插件 backend 集成测试所需的最小 Host 运行态装配合同。
 *
 * 该入口只允许测试代码使用；生产 contribution 必须由真实 App composition 注入运行态。
 */
export interface PluginHostTestRuntimeOptions {
  readonly installedPluginIds?: readonly string[] | ReadonlySet<string>;
  readonly enabledPluginIds?: readonly string[] | ReadonlySet<string>;
}

export declare function installPluginHostTestRuntime(
  options: PluginHostTestRuntimeOptions,
): void;

export declare function resetPluginHostTestRuntime(): void;
