import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLocalizationRegistryForTest,
  registerMessageCatalogs,
  resolveRegisteredMessage,
  unregisterMessageCatalogOwner,
} from './localizationRegistry';

describe('localizationRegistry', () => {
  beforeEach(() => {
    clearLocalizationRegistryForTest();
  });

  it('registers and resolves messages by locale', () => {
    registerMessageCatalogs({
      owner: 'settings',
      catalogs: {
        'zh-CN': {
          'settings.title': '设置',
        },
        'en-US': {
          'settings.title': 'Settings',
        },
      },
    });

    expect(resolveRegisteredMessage('zh-CN', 'settings.title')).toBe('设置');
    expect(resolveRegisteredMessage('en-US', 'settings.title')).toBe('Settings');
  });

  it('removes messages when owner is unregistered', () => {
    registerMessageCatalogs({
      owner: 'settings',
      catalogs: {
        'zh-CN': {
          'settings.title': '设置',
        },
      },
    });

    unregisterMessageCatalogOwner('settings');

    expect(resolveRegisteredMessage('zh-CN', 'settings.title')).toBeNull();
  });

  it('rejects duplicate keys across owners for the same locale', () => {
    registerMessageCatalogs({
      owner: 'settings',
      catalogs: {
        'zh-CN': {
          'settings.title': '设置',
        },
      },
    });

    expect(() => registerMessageCatalogs({
      owner: 'workspace',
      catalogs: {
        'zh-CN': {
          'settings.title': '工作区设置',
        },
      },
    })).toThrow('message key 冲突');
  });
});
