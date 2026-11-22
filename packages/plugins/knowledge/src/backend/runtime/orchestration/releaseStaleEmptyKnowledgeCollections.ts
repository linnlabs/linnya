import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { QdrantAdapter } from '../../infrastructure/vector-store/QdrantAdapter';

type CollectionPort = Pick<QdrantAdapter, 'collectionExists' | 'getCollection' | 'countPoints' | 'deleteCollection'>;

/**
 * 早期版本建库时按当时的默认维度预建了空向量集合；新接入的嵌入模型维度不同，写入会被 Qdrant 拒绝。
 * 尚未建立索引的库（没有向量空间记录、没有已完成文档）里，确认为空的集合不含任何资料，删除后由首次写入按实际维度创建。
 *
 * 只在本次激活的向量服务首次就绪、任何任务拿到地址之前调用（同一 Workspace 只有一个后台写入者），因此没有并发写入。
 * 点数必须由集合信息与精确计数同时证明为 0；任何一项读不到都保留集合。
 */
export async function releaseStaleEmptyKnowledgeCollections(input: {
  readonly metadata: Pick<MetadataRepository, 'getAllKnowledgeBases' | 'getDocumentsInKnowledgeBase' | 'indexState'>;
  readonly collections: CollectionPort;
}): Promise<readonly string[]> {
  const released: string[] = [];
  for (const library of await input.metadata.getAllKnowledgeBases()) {
    if (input.metadata.indexState.read(library.id).spaceId) continue;
    const documents = await input.metadata.getDocumentsInKnowledgeBase(library.id);
    if (documents.some(document => document.status === 'completed')) continue;
    if (!(await input.collections.collectionExists(library.id))) continue;
    const info = await input.collections.getCollection(library.id);
    if (info.points_count !== 0) continue;
    if ((await input.collections.countPoints(library.id, { exact: true })) !== 0) continue;
    await input.collections.deleteCollection(library.id);
    released.push(library.id);
  }
  return released;
}
