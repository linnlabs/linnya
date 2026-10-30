import type {
  SlidesImportedImage,
  SlidesInsertedObject,
  SlidesAuthoringEditRef,
} from '@plugin/slides/shared/authoringEditing';
import type { PresentationRepositoryPort } from '../../../persistence';
import { copyManualObjects } from '../functions/copyManualObjects';

/** 对象复制与图片接管属于编辑用例；协调器只转交，不解释作者值。 */
export class PresentationObjectTransferRuntime {
  constructor(
    private readonly repository: Pick<PresentationRepositoryPort, 'getPresentation'>,
    private readonly imageImporter:
      | ((documentId: string, bytes: Uint8Array) => Promise<SlidesImportedImage>)
      | undefined
  ) {}

  async copyObjects(input: {
    documentId: string;
    revisionId: string;
    targets: readonly SlidesAuthoringEditRef[];
  }): Promise<readonly SlidesInsertedObject[]> {
    const current = await this.repository.getPresentation(input.documentId);
    if (!current || current.currentRevisionId !== input.revisionId)
      throw new Error('文稿已变化，请重新复制。');
    return copyManualObjects(current.deckSpec, input.targets);
  }

  importImage(documentId: string, bytes: Uint8Array): Promise<SlidesImportedImage> {
    if (!this.imageImporter) throw new Error('图片导入暂不可用。');
    return this.imageImporter(documentId, bytes);
  }
}
