/** 无 App 装配依赖，standalone reader 也可消费同一 Workspace owner。 */
export {
  readWorkspaceDocumentMetadata,
  readWorkspaceDocumentIdentity,
  readWorkspaceDocumentLocation,
  resolveWorkspaceDocumentPath,
  listWorkspaceDocumentIds,
  touchWorkspaceDocument,
} from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
export type { WorkspaceDocumentMetadata } from '@linnya/plugin-host-contract/backend/workspaceDocumentProjection';

import type * as Contract from '@linnya/plugin-host-contract/backend/workspaceDocumentProjection';
// 新增运行时导出必须保持与插件可见窄合同一致。
type Projection = typeof import('src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection');
const contract: Projection extends typeof Contract ? true : never = true;
void contract;
