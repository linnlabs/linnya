export const SUPPORTED_LINNYA_LOCALES = ['zh-CN', 'en-US'] as const;

export type LinnyaLocale = (typeof SUPPORTED_LINNYA_LOCALES)[number];
export type MessageParamValue = string | number;
export type MessageParams = Readonly<Record<string, MessageParamValue>>;

export type LocalizedText =
  | string
  | {
      readonly key: string;
      readonly fallback: string;
      readonly params?: MessageParams;
    };

export type MessageCatalog = Readonly<Record<string, string>>;
export type MessageCatalogsByLocale = Readonly<Partial<Record<LinnyaLocale, MessageCatalog>>>;

export interface MessageCatalogContribution {
  readonly owner: string;
  readonly catalogs: MessageCatalogsByLocale;
}

export declare function registerMessageCatalogs(contribution: MessageCatalogContribution): void;
export declare function resolveLocalizedText(text: LocalizedText, options: {
  readonly locale: LinnyaLocale;
  readonly fallbackLocale: LinnyaLocale;
  readonly resolveMessage: (locale: LinnyaLocale, key: string) => string | null;
}): string;
export declare function resolveRegisteredMessage(locale: LinnyaLocale, key: string): string | null;
export declare function useLocalizationStore(): {
  readonly currentLocale: LinnyaLocale;
  readonly fallbackLocale: LinnyaLocale;
};
export declare function useLocalization(): {
  readonly currentLocale: import('vue').ComputedRef<LinnyaLocale>;
  readonly fallbackLocale: import('vue').ComputedRef<LinnyaLocale>;
  readonly t: (text: LocalizedText) => string;
  readonly message: (key: string, fallback: string, params?: MessageParams) => string;
  readonly changeLocale: (locale: LinnyaLocale) => void;
};
