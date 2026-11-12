import type { AuditCategory } from '../definitions/sourceAudit';

export const SOURCE_PATTERN =
  /\.(?:[cm]?[jt]sx?|vue|css|scss|rs|py|sh|ps1|cs|html|nsh|bat|cmd|applescript|patch)$/u;
export const AST_PATTERN = /\.(?:[cm]?[jt]sx?|vue)$/u;
export const EXCLUDED_PATTERNS = [
  // 生成绑定与第三方原件不能算成自有实现的债务。
  /^packages\/parser-wasm\/pkg(?:-node)?\//u,
  /(?:^|\/)(?:vendor|vendored|third-party|__snapshots__)\//u,
  /\.generated\.[cm]?[jt]s$/u,
];

export function categoryFor(file: string): AuditCategory {
  if (/\.d\.[cm]?ts$/u.test(file)) return 'declaration';
  if (
    /(?:^|\/)(?:test|tests|__tests__|__test__|__integration-tests__|fixtures|testkit|test-support)(?:\/|\.)|\.(?:test|spec|bench)\.[cm]?[jt]sx?$|(?:^|\/)(?:test_[^/]+|[^/]+_test|[^/]+_test_support|tests)\.rs$/u.test(
      file
    )
  )
    return 'test';
  if (
    /(?:^|\/)(?:scripts|build|dev|conformance|examples)\/|^patches\/|^apps\/linnya-benchmark\/|(?:^|\/)example\.[cm]?[jt]sx?$|(?:^|\/)[^/]*(?:config|\.config)\.[cm]?[jt]s$/u.test(
      file
    )
  )
    return 'tooling';
  return 'production';
}
