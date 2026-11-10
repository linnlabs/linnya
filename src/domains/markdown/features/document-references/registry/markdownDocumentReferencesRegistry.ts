import type { MarkdownDocumentReferencesPort } from '../definitions/markdownDocumentReferences';
const ports = new WeakMap<object, MarkdownDocumentReferencesPort>();
export function bindMarkdownDocumentReferences(scope: object, port: MarkdownDocumentReferencesPort): void { ports.set(scope, port); }
export function getMarkdownDocumentReferences(scope: object): MarkdownDocumentReferencesPort | undefined { return ports.get(scope); }
