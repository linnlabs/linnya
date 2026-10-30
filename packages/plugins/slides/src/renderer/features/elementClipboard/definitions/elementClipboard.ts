import type { SlidesInsertedObject } from '@plugin/slides/shared/authoringEditing';
export interface SlideClipboardContent { readonly documentId: string; readonly objects: readonly SlidesInsertedObject[] }
