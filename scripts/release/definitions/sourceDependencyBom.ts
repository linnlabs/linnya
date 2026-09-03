export interface SourceDependencySupplementalNotice {
  readonly content: string;
  readonly id: string;
  readonly licenseExpression: string;
  readonly source: string;
  readonly title: string;
}

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
