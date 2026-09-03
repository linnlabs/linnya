import { beforeAll, describe, expect, it } from 'vitest';

import {
  findFormatOwnershipByExtension,
  findFormatOwnershipByNodeType,
  listFormatOwnershipRecords,
} from '../formatOwnershipCatalog';
import { ensureBuiltinBackendPluginsRegistered } from '../builtin';
import { backendPluginRegistry } from '../registry';

describe('formatOwnershipCatalog', () => {
  beforeAll(() => {
    ensureBuiltinBackendPluginsRegistered({ requireComplete: true });
    backendPluginRegistry.register({
      meta: {
        id: 'format-owner-fixture',
        name: 'Format Owner Fixture',
        version: '1.0.0',
        description: 'Anonymous plugin format ownership fixture',
        developer: 'Fixture',
        builtin: false,
        ownedFileTypes: [{
          nodeType: 'fixture-canvas',
          extension: '.fixture',
          label: 'Fixture Canvas',
        }],
      },
    });
  });

  it('exposes file ownership from registered contribution metadata', () => {
    expect(listFormatOwnershipRecords()).toEqual(
      expect.arrayContaining([
        {
          pluginId: 'format-owner-fixture',
          pluginName: 'Format Owner Fixture',
          nodeType: 'fixture-canvas',
          extension: '.fixture',
          label: 'Fixture Canvas',
        },
      ])
    );
  });

  it('resolves ownership by node type and file extension', () => {
    expect(findFormatOwnershipByNodeType('fixture-canvas')).toMatchObject({
      pluginId: 'format-owner-fixture',
      extension: '.fixture',
    });

    expect(findFormatOwnershipByExtension('example.FIXTURE')).toMatchObject({
      pluginId: 'format-owner-fixture',
      nodeType: 'fixture-canvas',
    });

    expect(findFormatOwnershipByExtension('notes.unknown')).toBeNull();
  });

  it('does not require a Host plugin ID allowlist', () => {
    expect(findFormatOwnershipByExtension('example.FIXTURE')).toMatchObject({
      pluginId: 'format-owner-fixture',
      nodeType: 'fixture-canvas',
    });
  });
});
