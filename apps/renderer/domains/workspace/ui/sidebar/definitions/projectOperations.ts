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
}
