import type { KnowledgeCitationSearchPort } from '../features/citation/definitions/knowledgeCitationSearch';

let port: KnowledgeCitationSearchPort | null = null;

export function registerKnowledgeCitationSearchPort(next: KnowledgeCitationSearchPort): () => void {
  port = next;
  return () => { if (port === next) port = null; };
}

export function getKnowledgeCitationSearchPort(): KnowledgeCitationSearchPort {
  if (!port) throw new Error('Knowledge citation search port has not been installed');
  return port;
}
