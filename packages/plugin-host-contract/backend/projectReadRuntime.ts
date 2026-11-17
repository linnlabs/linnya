/** 项目摘要仅用于关联选择和存在性校验，不授予项目生命周期写权限。 */
export type { ProjectSummary as PluginProjectSummary } from '@app/schemas';
import type { ProjectSummary as PluginProjectSummary } from '@app/schemas';

export interface PluginProjectReadPort {
  get(projectId: string): PluginProjectSummary | undefined;
}

export declare function getPluginProjectReadPort(): PluginProjectReadPort;
