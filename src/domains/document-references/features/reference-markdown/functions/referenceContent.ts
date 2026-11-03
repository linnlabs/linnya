/** 浏览器与 Backend 共用同一份纯 Markdown 身份变换，不加载编辑器/DOM。 */
export { referenceObject, referenceChildren, collectDocumentReferenceInputs, workspaceReferenceHref, normalizedReferencePath, encodedReferencePath, commonReferenceMarks, transformWorkspaceReferenceLinks, hydrateDocumentReferenceLinks } from '@linnya/markdown-document-core/references';
export type { ReferenceJsonObject } from '@linnya/markdown-document-core/references';
