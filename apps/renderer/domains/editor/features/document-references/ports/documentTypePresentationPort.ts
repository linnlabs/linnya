import type { DocumentTypePresentationPort } from '../definitions/documentTypePresentation';
let port: DocumentTypePresentationPort | null = null;
export function registerDocumentTypePresentationPort(value: DocumentTypePresentationPort): void {
  port = value;
}
export function getDocumentTypePresentationPort(): DocumentTypePresentationPort {
  if (!port) throw new Error('Document type presentation port is not installed');
  return port;
}
