import { describe, expect, it } from 'vitest';

import { parsePluginRendererStylesheetManifest } from './renderer-stylesheet-manifest';

describe('PluginRendererStylesheetManifest', () => {
  it('保留声明顺序并接受空样式集合', () => {
    expect(parsePluginRendererStylesheetManifest({
      schemaVersion: 1,
      stylesheets: ['assets/base-a1.css', 'assets/card-b2.css'],
    }).stylesheets).toEqual(['assets/base-a1.css', 'assets/card-b2.css']);

    expect(parsePluginRendererStylesheetManifest({
      schemaVersion: 1,
      stylesheets: [],
    }).stylesheets).toEqual([]);
  });

  it('拒绝重复、越界和非 CSS 路径', () => {
    expect(() => parsePluginRendererStylesheetManifest({
      schemaVersion: 1,
      stylesheets: ['assets/base.css', 'assets/base.css'],
    })).toThrow();
    expect(() => parsePluginRendererStylesheetManifest({
      schemaVersion: 1,
      stylesheets: ['../host.css'],
    })).toThrow();
    expect(() => parsePluginRendererStylesheetManifest({
      schemaVersion: 1,
      stylesheets: ['assets/runtime.js'],
    })).toThrow();
  });
});
