import type { ReferenceNode } from '../../../definitions/documentReferences';
export interface ReferenceQueryPort {
  read(documentId: string): ReferenceNode | null;
  search(input: { readonly projectId: string; readonly keyword: string; readonly limit: number }): readonly { readonly id: string; readonly name: string; readonly nodeType: string; readonly projectId: string }[];
  location(documentId: string): { readonly path: string } | null;
  isDocumentTypeAvailable(nodeType: string): boolean;
}
