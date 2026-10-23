import type Database from 'better-sqlite3';
import type { WorkspaceVerifiedImageLoaderPort } from 'src/features/workspace/assets/shared/verified-image';

/** Renderer 只能显示已被文档持有的资产；路径解析、真实内容与哈希由既有 loader 验证。 */
export async function readDocumentImageAsset(input: {
  readonly db: Database.Database;
  readonly loader: WorkspaceVerifiedImageLoaderPort;
  readonly assetId: string;
}) {
  const owner = input.db
    .prepare<
      [string],
      { found: number }
    >('SELECT 1 AS found FROM document_asset_links WHERE asset_id = ? LIMIT 1')
    .get(input.assetId);
  if (!owner) throw new Error('Document image asset has no retained owner.');
  const [image] = await input.loader.loadImages([{ assetId: input.assetId }]);
  if (!image) throw new Error('Document image loader returned no image.');
  return image;
}
