export interface SourceDependencySupplementalNotice {
  readonly content: string;
  readonly id: string;
  readonly licenseExpression: string;
  readonly source: string;
  readonly title: string;
}

/** 原生平台包只有聚合许可证声明时，锁定其内部静态组件审计证据。 */
export const NAPI_RS_CANVAS_NATIVE_NOTICE_EVIDENCE = {
  packageName: '@napi-rs/canvas',
  version: '1.0.8',
  evidencePath:
    'scripts/release/evidence/reviewed-upstream-licenses/napi-rs-canvas-1.0.8-native-components.txt',
  contentSha256: 'c5fe8e970eab66c1e930c32f141e1709ea8867bb17d744403ee926ba8927eac4',
  notice: {
    id: 'napi-rs-canvas-1.0.8-native-components',
    title: '@napi-rs/canvas 1.0.8 native components',
    source: 'https://github.com/Brooooooklyn/canvas/tree/95db9ae7783b6acb9320e6c36a22abd943d3351c',
    licenseExpression:
      'MIT AND BSD-2-Clause AND BSD-3-Clause AND Apache-2.0 AND MPL-2.0 AND Unicode-3.0 AND ISC AND Zlib AND LicenseRef-FreeType AND LicenseRef-IJG AND LicenseRef-libpng-2.0',
  },
} as const;

export const CRAFT_AGENTS_OAUTH_NOTICE = {
  id: 'craft-agents-oauth-derived-source',
  title: 'Craft Agents OAuth derived source',
  source:
    'https://github.com/craft-ai-agents/craft-agents-oss/tree/50ffa143ab76e44c0e96ea785d03aa67cf942c50',
  licenseExpression: 'Apache-2.0',
  content: `Craft Agents
Copyright 2026 Craft Docs Ltd.

This product includes software developed by Craft Docs Ltd.
https://craft.do`,
} as const satisfies SourceDependencySupplementalNotice;

export const MODELS_DEV_CATALOG_NOTICE = {
  id: 'models-dev-catalog-data',
  title: 'models.dev catalog data',
  source: 'https://github.com/anomalyco/models.dev',
  licenseExpression: 'MIT',
  content: `MIT License

Copyright (c) 2025 models.dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
} as const satisfies SourceDependencySupplementalNotice;
