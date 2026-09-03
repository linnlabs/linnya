import type { WorkspaceVfsNodeTypeAccessPolicy } from '../../../features/workspace/vfs/orchestration/listWorkspaceVfsNodes';
import { findFormatOwnershipByNodeType } from './formatOwnershipCatalog';
import { isPluginRuntimeEnabled } from './pluginRuntimeState';
import { buildPluginRuntimeDisabledMessage } from './pluginRuntimeAccess';

/**
 * 中文说明：
 * - Workspace/VFS 只知道“某个 nodeType 是否由插件拥有”，不认识具体插件格式；
 * - 具体归属来自 host 侧格式目录，运行态来自 DB provider。
 */
export const pluginWorkspaceVfsNodeTypeAccessPolicy: WorkspaceVfsNodeTypeAccessPolicy = {
  canReadContent(nodeType) {
    if (typeof nodeType !== 'string' || nodeType.length === 0) return true;
    const ownership = findFormatOwnershipByNodeType(nodeType);
    if (!ownership) return true;
    return isPluginRuntimeEnabled(ownership.pluginId);
  },
  buildDisabledMessage(nodeType, action) {
    const ownership = findFormatOwnershipByNodeType(nodeType);
    if (!ownership) {
      return `当前不能${action} ${nodeType} 类型的 Workspace 节点。`;
    }
    return buildPluginRuntimeDisabledMessage({
      pluginId: ownership.pluginId,
      pluginName: ownership.pluginName,
      action,
    });
  },
};
