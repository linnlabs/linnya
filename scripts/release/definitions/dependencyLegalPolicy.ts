import type {
  DependencyLicenseSelection,
  DependencySourceOverride,
  DependencySupplementalEvidenceFile,
} from './packageLegalEvidence';

/**
 * 多许可证选择和模糊旧标识只能按精确版本登记。升级后必须重新核对随包文本，
 * 不能只按 package name 继承旧结论。
 */
export const DEPENDENCY_LICENSE_SELECTIONS = [
  {
    packageName: 'brotli',
    version: '1.3.3',
    declaredExpression: 'MIT',
    selectedExpression: 'MIT AND Apache-2.0',
    reason:
      'package manifest 声明 MIT，但发布内容 dec/*.js 携带 Google Apache-2.0 版权与授权头；最终 NOTICE 必须同时覆盖两者',
  },
  {
    packageName: 'dompurify',
    version: '3.3.0',
    declaredExpression: '(MPL-2.0 OR Apache-2.0)',
    selectedExpression: 'Apache-2.0',
  },
  {
    packageName: 'dompurify',
    version: '3.4.14',
    declaredExpression: '(MPL-2.0 OR Apache-2.0)',
    selectedExpression: 'Apache-2.0',
  },
  {
    packageName: 'duck',
    version: '0.1.12',
    declaredExpression: 'BSD',
    selectedExpression: 'BSD-2-Clause',
  },
  {
    packageName: 'expand-template',
    version: '2.0.3',
    declaredExpression: '(MIT OR WTFPL)',
    selectedExpression: 'MIT',
  },
  {
    packageName: 'json-schema',
    version: '0.4.0',
    declaredExpression: '(AFL-2.1 OR BSD-3-Clause)',
    selectedExpression: 'BSD-3-Clause',
  },
  {
    packageName: 'jszip',
    version: '3.10.1',
    declaredExpression: '(MIT OR GPL-3.0-or-later)',
    selectedExpression: 'MIT',
  },
  {
    packageName: 'node-forge',
    version: '1.4.0',
    declaredExpression: '(BSD-3-Clause OR GPL-2.0)',
    selectedExpression: 'BSD-3-Clause',
  },
  {
    packageName: 'ot-text-unicode',
    version: '4.0.0',
    declaredExpression: 'ISC',
    selectedExpression: 'MIT',
    reason:
      '发布 manifest 声明 ISC，但同一 registry tarball 的 README 明确给出完整 MIT 授权正文；保留 declared/concluded 差异',
  },
  {
    packageName: 'pako',
    version: '1.0.11',
    declaredExpression: '(MIT AND Zlib)',
    selectedExpression: 'MIT AND Zlib',
  },
  {
    packageName: 'rc',
    version: '1.2.8',
    declaredExpression: '(BSD-2-Clause OR MIT OR Apache-2.0)',
    selectedExpression: 'MIT',
  },
  {
    packageName: 'speakingurl',
    version: '14.0.1',
    declaredExpression: 'BSD',
    selectedExpression: 'BSD-3-Clause',
  },
  {
    packageName: 'type-fest',
    version: '4.41.0',
    declaredExpression: '(MIT OR CC0-1.0)',
    selectedExpression: 'MIT',
  },
] as const satisfies readonly DependencyLicenseSelection[];

/** 上游 manifest 没有 repository/homepage 时，精确登记公开版本页。 */
export const DEPENDENCY_SOURCE_OVERRIDES = [
  {
    packageName: '@sevinf/maybe',
    version: '0.5.0',
    source: 'https://www.npmjs.com/package/@sevinf/maybe/v/0.5.0',
    reason: '发布包 manifest 未声明 repository/homepage',
  },
  {
    packageName: 'https',
    version: '1.0.0',
    source: 'https://www.npmjs.com/package/https/v/1.0.0',
    reason: '发布包只有 package.json，未声明 repository/homepage',
  },
  {
    packageName: 'markdown-it-ts',
    version: '0.0.3',
    source: 'https://www.npmjs.com/package/markdown-it-ts/v/0.0.3',
    reason: '发布包 manifest 未声明 repository/homepage',
  },
] as const satisfies readonly DependencySourceOverride[];

/** 普通 LICENSE/NOTICE 自动发现；这里只登记另有法律或版本意义的随包文件。 */
export const DEPENDENCY_SUPPLEMENTAL_EVIDENCE_FILES = [
  {
    packageName: '@img/sharp-libvips-darwin-arm64',
    version: '1.3.3',
    relativePath: 'README.md',
    kind: 'notice',
    reason: '记录 libvips 及其嵌套 native libraries 的许可证选择',
  },
  {
    packageName: '@img/sharp-libvips-darwin-arm64',
    version: '1.3.3',
    relativePath: 'versions.json',
    kind: 'metadata',
    reason: '锁定当前 macOS arm64 native runtime 的嵌套组件版本',
  },
] as const satisfies readonly DependencySupplementalEvidenceFile[];
