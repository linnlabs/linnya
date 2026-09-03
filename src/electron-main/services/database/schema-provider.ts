/**
 * @file schema-provider.ts
 *
 * @description
 * 为了避免 `core/*` 与 `features/*` 反向依赖 `electron-main/*`，
 * ISchemaProvider 已上移到 `src/shared/database/schema-provider.ts`。
 *
 * 这里保留 re-export，确保现有导入路径不需要一次性全改完。
 */

export type { ISchemaProvider } from '../../../shared/database/schema-provider';

