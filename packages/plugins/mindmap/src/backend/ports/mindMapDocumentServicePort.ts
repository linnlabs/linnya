import type { MindMapDocumentService } from '../persistence/mindmap_document/services/mindmap_document.service';

export type MindMapDocumentServicePort = Pick<
  MindMapDocumentService,
  'createDocument' | 'getDocument' | 'updateDocument'
>;
