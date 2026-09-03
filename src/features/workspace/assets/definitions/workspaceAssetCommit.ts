/**
 * @file workspaceAssetCommit.ts
 * @description Workspace 资产在 host SQLite 短事务中的登记合同。
 *
 * 中文说明：
 * - 该记录由 app-level orchestration 根据已验证的受管文件构造；
 * - assetId 必须在构造消息聚合前解析为 canonical ID；
 * - persistence adapter 只消费该窄合同，不依赖图片 ingress 内部注册表。
 */

export interface WorkspaceAssetCommitRecord {
  readonly assetId: string;
  readonly uri: string;
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly localPath: string;
  readonly createdAt: number;
}
