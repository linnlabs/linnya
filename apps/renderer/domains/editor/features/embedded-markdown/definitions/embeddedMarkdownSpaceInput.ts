import type { Node } from '@tiptap/pm/model';
import type { Mapping, Step } from '@tiptap/pm/transform';
export interface EmbeddedMarkdownSpaceInput {
  readonly steps: readonly Step[];
  readonly documents: readonly Node[];
  readonly mapping: Pick<Mapping, 'maps' | 'getMirror'>;
  readonly following: Mapping;
}
