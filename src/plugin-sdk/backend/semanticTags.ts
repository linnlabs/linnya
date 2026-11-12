/** 无 App 装配依赖，standalone reader 也可消费同一语义层 owner。 */
export {
  listSemanticTagNames,
  readSemanticTagNames,
  resolveSemanticTagNames,
} from 'src/domains/semantic-layer/infrastructure/sqlite/semanticTagProjection';
export type {
  SemanticTagName,
  SemanticTagResolution,
} from '@linnya/plugin-host-contract/backend/semanticTags';

import type * as Contract from '@linnya/plugin-host-contract/backend/semanticTags';
// 新增运行时导出必须保持与插件可见窄合同一致。
type Projection = typeof import('src/domains/semantic-layer/infrastructure/sqlite/semanticTagProjection');
const contract: Projection extends typeof Contract ? true : never = true;
void contract;
