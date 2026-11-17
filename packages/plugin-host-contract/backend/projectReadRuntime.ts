/** 项目摘要仅用于关联选择和存在性校验，不授予项目生命周期写权限。 */
export interface PluginProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
}

export interface PluginProjectReadPort {
  get(projectId: string): PluginProjectSummary | undefined;
}

export declare function getPluginProjectReadPort(): PluginProjectReadPort;
