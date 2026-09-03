import { describe, expect, it } from 'vitest';

import { findExternalProviderRuntimeRequires } from './findExternalProviderRuntimeRequires.mjs';

describe('findExternalProviderRuntimeRequires', () => {
  it('识别 adapter、官方 namespace、Core 和 registry 声明的第三方 Provider package', () => {
    const bundle = `
      var adapter = require("@linnlabs/linnkit-provider-ai-sdk");
      var core = require("ai");
      var openai = require("@ai-sdk/openai");
      var openrouter = require("@openrouter/ai-sdk-provider");
      var factory = { package_name: "@openrouter/ai-sdk-provider" };
      var native = require("better-sqlite3");
    `;

    expect(findExternalProviderRuntimeRequires(bundle)).toEqual([
      '@ai-sdk/openai',
      '@linnlabs/linnkit-provider-ai-sdk',
      '@openrouter/ai-sdk-provider',
      'ai',
    ]);
  });

  it('不把非 Provider external 或已内联 package 元数据误报为运行时 require', () => {
    const bundle = `
      var factory = { "package_name": "@openrouter/ai-sdk-provider" };
      var native = require("better-sqlite3");
    `;

    expect(findExternalProviderRuntimeRequires(bundle)).toEqual([]);
  });
});
