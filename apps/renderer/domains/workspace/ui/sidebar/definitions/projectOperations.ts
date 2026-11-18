/** 项目弹窗提交值；知识库关联随项目创建一起提交。 */
export interface ProjectFormValues {
  name: string;
  description: string;
  kbIds: string[];
}

export interface ProjectEditData {
  id: string;
  name: string;
  description: string;
}

/** app 组合层注入完整导航，Workspace 不自行切换跨域的文档/对话状态。 */
export interface ProjectOperationsOptions {
  openProjectWorkspace: (projectId: string) => Promise<void>;
  startProjectPlanning: (project: ProjectEditData) => Promise<boolean>;
  deleteProject: (projectId: string) => Promise<void>;
  /**
   * 保存新建项目时选的关联资料；由 App 从知识库应用槽接入，没有该槽时不提供。
   * 失败要抛错，这里负责提示；Workspace 不知道插件或它的 IPC。
   */
  saveProjectCreationSelection?: (projectId: string, ids: readonly string[]) => Promise<void>;
}
