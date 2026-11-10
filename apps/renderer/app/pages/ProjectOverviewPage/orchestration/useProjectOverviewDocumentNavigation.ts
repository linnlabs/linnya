import { useLocalization } from '@/app/localization';
import { useNotificationStore } from '@/app/notification';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { resolveDocumentTypeByNodeType } from '@/app/plugins/registry';
import { getDocumentTypeUnavailableMessage } from '@/app/plugins/functions/documentTypeUnavailablePresentation';
import { resolveDocumentTypeTextPresentation } from '@/app/plugins/functions/pluginContributionPresentation';
import type { ProjectOverviewDocumentTarget } from '@/domains/workspace/features/project-overview/definitions/projectOverview';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

/** 数据节点类型不等于编辑器类型；由 app 注册表解析，并沿用文件树的不可用提示。 */
export function useProjectOverviewDocumentNavigation() {
  const plugins = useEnabledPluginsStore();
  const notifications = useNotificationStore();
  const navigation = getWorkspaceNavigationPort();
  const { workspaceMessage } = useWorkspaceLocalization();
  const { t } = useLocalization();

  return async (row: ProjectOverviewDocumentTarget, projectId: string): Promise<void> => {
    const availability = resolveDocumentTypeByNodeType(row.nodeType, plugins.enabledPluginIds, plugins.states);
    if (availability.state !== 'enabled') {
      notifications.show(getDocumentTypeUnavailableMessage(availability, {
        disabled: params => workspaceMessage('workspace.sidebar.node.unavailable.disabled', params),
        missing: params => workspaceMessage('workspace.sidebar.node.unavailable.missing', params),
        loadFailed: params => workspaceMessage('workspace.sidebar.node.unavailable.loadFailed', params),
        unknown: params => workspaceMessage('workspace.sidebar.node.unavailable.unknown', params),
        fallback: () => workspaceMessage('workspace.sidebar.node.unavailable.fallback'),
      }, documentType => resolveDocumentTypeTextPresentation(documentType, t).label), 'warning');
      return;
    }

    try {
      await navigation.openDocument({
        documentId: row.documentId,
        type: availability.documentType.activeDocumentType,
        projectId,
        displayName: row.title,
        parentId: row.parentId,
      });
    } catch (error: unknown) {
      console.error('[ProjectOverview] 打开文档失败:', { documentId: row.documentId, nodeType: row.nodeType, error });
      notifications.show(workspaceMessage('workspace.sidebar.node.openFailed', { documentName: row.title }), 'error');
    }
  };
}
