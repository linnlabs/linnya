import { z } from 'zod';
import { CanvasSnapshotSchema } from '@plugin/canvas/shared';

/** 桥属于项目并不代表它仍挂载本题画布；错误对象只能留作原始失败证据。 */
export function readEvaluationSnapshot(value: unknown, documentId: string) {
  const { snapshot } = z.object({ snapshot: CanvasSnapshotSchema }).parse(value);
  if (snapshot.documentId !== documentId)
    throw new Error(
      `Evaluation bridge returned another Canvas document: expected ${documentId}, got ${snapshot.documentId}`
    );
  return snapshot;
}
