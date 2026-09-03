export { getCurrentRootBlockIdSetFromDoc, type ProseMirrorDocLike } from './functions/rootBlockIds';
export { AudioBlockService, type AudioBlock, type AudioBlockNote, type AudioBlockSummary, type AudioBlockTranscript } from './infrastructure/sqlite/audioBlockService';
export { CodeBlockService, type CodeBlock } from './infrastructure/sqlite/codeBlockService';
export { ImageBlockProjectionService } from './infrastructure/sqlite/imageBlockProjectionService';
export { ImageBlockService, type ImageBlock } from './infrastructure/sqlite/imageBlockService';
export {
  MarkdownImageBlockReader,
  type MarkdownDocumentImage,
} from './infrastructure/sqlite/markdownImageBlockReader';
export { LatexBlockService, type LatexBlock } from './infrastructure/sqlite/latexBlockService';
export { TableBlockService, type TableBlock } from './infrastructure/sqlite/tableBlockService';
