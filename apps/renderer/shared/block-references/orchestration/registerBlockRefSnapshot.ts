import { useBlockIndexSnapshotStore } from '../../stores/blockIndexSnapshotStore';
import { createBlockRefSnapshot } from '../functions/createBlockRefSnapshot';

export async function registerBlockRefSnapshot(
  documentId: string,
  blockIds: string[]
): Promise<void> {
  const store = useBlockIndexSnapshotStore();
  const snapshot = await createBlockRefSnapshot(documentId, blockIds);
  store.setSnapshot(snapshot);
  console.log(
    `[blockIndexSnapshotStore] 注册 ref 快照: documentId=${documentId}, blocks=${blockIds.length}`
  );
}
