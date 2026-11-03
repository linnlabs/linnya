import type { DocumentBacklink } from '@app/schemas';
import type { ReferenceNodePort } from '../../../definitions/documentReferences';
export interface BacklinkQueryPort extends ReferenceNodePort {
  listBacklinks(documentId: string): readonly DocumentBacklink[];
}
