import type { WebSearchCitation, DeepWebResearchNotes } from '@app/schemas';

export interface WebSearchDisplayItem {
  readonly id: string;
  readonly docTitle: string;
  readonly url: string;
  readonly snippet: string;
  readonly publishedAt?: string;
}

export type WebSearchPresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly requestedDeepSearch?: boolean;
    }
  | {
      readonly kind: 'results';
      readonly query: string;
      readonly requestedDeepSearch?: boolean;
      readonly strategy?: 'deep' | 'shallow';
      readonly limited?: boolean;
      readonly subrunIds?: readonly string[];
      readonly materials?: DeepWebResearchNotes;
      readonly items: readonly WebSearchDisplayItem[];
    };

export function toWebSearchDisplayItem(citation: WebSearchCitation): WebSearchDisplayItem {
  return {
    id: citation.ref,
    docTitle: citation.docTitle,
    url: citation.url,
    snippet: citation.snippet,
    ...(citation.publishedAt ? { publishedAt: citation.publishedAt } : {}),
  };
}
