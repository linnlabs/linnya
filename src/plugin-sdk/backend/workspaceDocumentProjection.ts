/** 无 App 装配依赖，standalone reader 也可消费同一 Workspace owner。 */
export {
  readWorkspaceDocumentMetadata,
  listWorkspaceDocumentIds,
  touchWorkspaceDocument,
} from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
export type { WorkspaceDocumentMetadata } from '@linnya/plugin-host-contract/backend/workspaceDocumentProjection';

import type * as Contract from '@linnya/plugin-host-contract/backend/workspaceDocumentProjection';
import * as Projection from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
// 新增运行时导出必须保持与插件可见窄合同一致。
const contract: typeof Contract = Projection;
void contract;
