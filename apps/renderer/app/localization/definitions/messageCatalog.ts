import type { LinnyaLocale } from './locale';

export type MessageCatalog = Readonly<Record<string, string>>;
export type MessageCatalogsByLocale = Readonly<Partial<Record<LinnyaLocale, MessageCatalog>>>;

export interface MessageCatalogContribution {
  readonly owner: string;
  readonly catalogs: MessageCatalogsByLocale;
}
