/**
 * 删除一个明确命名的 Qdrant collection，用于重建不兼容的历史向量 schema。
 *
 * 该操作不可恢复，因此 --confirm 必须与 --collection 完全一致。
 */
import { QdrantAdapter } from 'src/infra/adapters/vector-store/qdrant';

function readArgValue(argv: readonly string[], key: string): string | undefined {
  const index = argv.indexOf(key);
  if (index < 0) return undefined;
  const value = argv[index + 1]?.trim();
  return value || undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const collectionName = readArgValue(argv, '--collection');
  const confirmation = readArgValue(argv, '--confirm');
  const qdrantUrl = readArgValue(argv, '--qdrantUrl') ?? 'http://127.0.0.1:6333';

  if (!collectionName) {
    throw new Error('缺少参数：--collection <collection_name>');
  }
  if (confirmation !== collectionName) {
    throw new Error('--confirm 必须与 --collection 完全一致');
  }

  const adapter = QdrantAdapter.getInstance({
    url: qdrantUrl,
    timeout: 30_000,
    checkCompatibility: false,
  });
  if (!(await adapter.collectionExists(collectionName))) {
    console.log(`[KB-VECTOR-COLLECTION] collection 不存在，无需删除：${collectionName}`);
    return;
  }
  await adapter.deleteCollection(collectionName);
  console.log(`[KB-VECTOR-COLLECTION] 已删除：${collectionName}`);
}

main().catch((error: unknown) => {
  console.error(
    '[KB-VECTOR-COLLECTION] 删除失败：',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
