import { readWorkspaceDocumentLocation } from '@plugin/backend/workspaceDocumentProjection';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import type { CanvasSnapshot } from '../../../../shared';
import {
  listCanvasReferencedDocuments,
  type CanvasProjectionContext,
} from '../../canvasProjection';
import { readCanvasDocumentIdentity } from './readCanvasDocumentIdentity';

export function readCanvasProjectionContext(
  database: Pick<CanvasDatabase, 'prepare'>,
  snapshot: CanvasSnapshot
): CanvasProjectionContext {
  const source = readCanvasDocumentIdentity(database, snapshot.documentId);
  const documentPaths = new Map<string, string>();
  const documentTitles = new Map<string, string>();
  for (const targetId of listCanvasReferencedDocuments(snapshot.elements)) {
    const target = readWorkspaceDocumentLocation(database, targetId);
    if (target && target.projectId === source.projectId) {
      documentPaths.set(targetId, target.path);
      documentTitles.set(targetId, target.path.slice(target.path.lastIndexOf('/') + 1));
    }
  }
  return { name: source.name, documentPaths, documentTitles };
}
