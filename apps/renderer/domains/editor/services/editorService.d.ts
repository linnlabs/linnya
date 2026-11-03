import type { EditorDocumentLoadOptions } from '../definitions/editorDocumentLoad';

/** 既有 JavaScript 装载入口的显式合同，供 TypeScript 业务调用和集成验证使用。 */
export function loadDocumentFromDatabase(options: EditorDocumentLoadOptions): Promise<void>;
