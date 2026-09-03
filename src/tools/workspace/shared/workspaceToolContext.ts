import { derivePluginAwareToolContext } from '../../../app-hosts/linnya/plugin-registry/toolContextDerivation';
import { WorkspaceService } from '../../../electron-main/services/workspace/workspace';
import type { ToolContext } from '../../types';

export interface WorkspaceServiceToolContextResolution {
  readonly context: ToolContext;
  readonly workspaceService: WorkspaceService;
}

export function ensureWorkspaceServiceToolContext(context: ToolContext): WorkspaceServiceToolContextResolution {
  if (context.workspaceService) {
    return {
      context,
      workspaceService: context.workspaceService,
    };
  }

  const databaseService = context.databaseService;
  if (!databaseService) {
    throw new Error('Workspace database not available in tool context.');
  }

  const workspaceService = new WorkspaceService(databaseService.getDb(), {
    mutationPublisher: context.workspaceMutationPublisher,
  });

  // 中文说明：补齐 workspaceService 时必须通过插件感知派生入口。
  // 插件可以把 coordinator/provider 存在 ToolContext 的 WeakMap 绑定里；
  // 裸对象展开会静默丢绑定，导致 host 工具调用插件 document hook 时进入错误运行态。
  return {
    context: derivePluginAwareToolContext(context, { workspaceService }),
    workspaceService,
  };
}
