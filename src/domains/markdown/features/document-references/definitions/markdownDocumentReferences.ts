import type { DocumentReferenceInput, DocumentReferenceMarkdownBinding, JsonValue } from '@app/schemas';

export interface MarkdownReferenceReadBaseline {
  readonly sourceKey: string;
  readonly bindings: readonly DocumentReferenceMarkdownBinding[];
  readonly unprojectableReferenceIds: readonly string[];
}
/** Markdown 拥有正文与 pending；身份解析和反向索引由 Host 装配的窄能力拥有。 */
export interface MarkdownDocumentReferencesPort {
  project(input: { readonly sourceDocumentId: string; readonly content: JsonValue }): { readonly content: JsonValue; readonly bindings: readonly DocumentReferenceMarkdownBinding[]; readonly unprojectableReferenceIds: readonly string[] };
  hydrate(input: { readonly content: JsonValue; readonly bindings: readonly DocumentReferenceMarkdownBinding[] }): JsonValue;
  admit(input: { readonly readerId: string; readonly sourceDocumentId: string; readonly sourceKey: string; readonly content: JsonValue; readonly existingContent?: JsonValue }): { readonly content: JsonValue; readonly bindings: readonly DocumentReferenceMarkdownBinding[] };
  assertBindings(input: { readonly sourceDocumentId: string; readonly bindings: readonly DocumentReferenceMarkdownBinding[] }): void;
  replace(documentId: string, references: readonly DocumentReferenceInput[], retained: readonly DocumentReferenceInput[]): void;
}
