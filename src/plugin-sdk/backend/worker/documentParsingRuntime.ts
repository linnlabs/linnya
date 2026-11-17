/** Worker 构建必须内联同一实现，不依赖父线程的临时 Module._load hook。 */
export { parsePluginDocument, countPluginPdfPages, parsePluginPdfPages, generateParsedBlockId, hasDocumentOcrPageLimit, assertDocumentOcrPageLimit } from '../documentParsingRuntime';
export type * from '@linnya/plugin-host-contract/backend/documentParsingRuntime';
