import { ref, type Ref } from 'vue';
import {
  SUPPORTED_LINNYA_LOCALES,
  type LinnyaLocale,
} from '../definitions/locale';
import type {
  MessageCatalog,
  MessageCatalogContribution,
} from '../definitions/messageCatalog';

const catalogsByOwner = new Map<string, Map<LinnyaLocale, MessageCatalog>>();
const localizationRegistryRevision = ref(0);

function bumpRevision(): void {
  localizationRegistryRevision.value += 1;
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`[localizationRegistry] ${field} 不能为空`);
  }
}

function findConflictingOwner(
  owner: string,
  locale: LinnyaLocale,
  key: string,
): string | null {
  for (const [registeredOwner, catalogs] of catalogsByOwner.entries()) {
    if (registeredOwner === owner) {
      continue;
    }
    const catalog = catalogs.get(locale);
    if (catalog && Object.prototype.hasOwnProperty.call(catalog, key)) {
      return registeredOwner;
    }
  }
  return null;
}

function validateCatalogContribution(contribution: MessageCatalogContribution): void {
  assertNonEmpty(contribution.owner, 'owner');

  for (const locale of SUPPORTED_LINNYA_LOCALES) {
    const catalog = contribution.catalogs[locale];
    if (!catalog) {
      continue;
    }

    for (const key of Object.keys(catalog)) {
      assertNonEmpty(key, 'message key');
      const conflictOwner = findConflictingOwner(contribution.owner, locale, key);
      if (conflictOwner) {
        throw new Error(
          `[localizationRegistry] message key 冲突: ${locale}/${key} (${conflictOwner} / ${contribution.owner})`,
        );
      }
    }
  }
}

export function registerMessageCatalogs(contribution: MessageCatalogContribution): void {
  validateCatalogContribution(contribution);

  const ownerCatalogs = new Map<LinnyaLocale, MessageCatalog>();
  for (const locale of SUPPORTED_LINNYA_LOCALES) {
    const catalog = contribution.catalogs[locale];
    if (catalog) {
      ownerCatalogs.set(locale, catalog);
    }
  }

  catalogsByOwner.set(contribution.owner, ownerCatalogs);
  bumpRevision();
}

export function unregisterMessageCatalogOwner(owner: string): void {
  if (catalogsByOwner.delete(owner)) {
    bumpRevision();
  }
}

export function resolveRegisteredMessage(locale: LinnyaLocale, key: string): string | null {
  for (const catalogs of catalogsByOwner.values()) {
    const message = catalogs.get(locale)?.[key];
    if (message !== undefined) {
      return message;
    }
  }
  return null;
}

export function useLocalizationRegistryRevision(): Readonly<Ref<number>> {
  return localizationRegistryRevision;
}

export function clearLocalizationRegistryForTest(): void {
  catalogsByOwner.clear();
  bumpRevision();
}
