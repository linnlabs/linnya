import type { ISchemaProvider } from '../../../../../../shared/database/schema-provider';

import { AUDIO_BLOCK_SCHEMAS } from './schemas/blocks/audio.schema';
import { BLOCK_HISTORY_SCHEMAS } from './schemas/blocks/block-history.schema';
import { CODE_BLOCK_SCHEMAS } from './schemas/blocks/code.schema';
import { IMAGE_BLOCK_SCHEMAS } from './schemas/blocks/image.schema';
import { LATEX_BLOCK_SCHEMAS } from './schemas/blocks/latex.schema';
import { PENDING_REVISION_SCHEMAS } from './schemas/blocks/pending-revision.schema';
import { TABLE_BLOCK_SCHEMAS } from './schemas/blocks/table.schema';
import { MARKDOWN_DOCUMENT_SCHEMAS } from './schemas/document.schema';

/** Markdown domain 对 workspace.sqlite 的核心 schema contribution。 */
export class MarkdownSchemaProvider implements ISchemaProvider {
  readonly name = 'markdown';

  getSchema(): string[] {
    return [
      ...MARKDOWN_DOCUMENT_SCHEMAS,
      ...AUDIO_BLOCK_SCHEMAS,
      ...CODE_BLOCK_SCHEMAS,
      ...IMAGE_BLOCK_SCHEMAS,
      ...LATEX_BLOCK_SCHEMAS,
      ...TABLE_BLOCK_SCHEMAS,
      ...BLOCK_HISTORY_SCHEMAS,
      ...PENDING_REVISION_SCHEMAS,
    ];
  }
}
