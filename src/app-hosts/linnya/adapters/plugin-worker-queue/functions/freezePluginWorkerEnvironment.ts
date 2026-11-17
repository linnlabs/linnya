const OS_ENVIRONMENT_KEYS = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'NODE_ENV',
]);

/** PDF 本地工具需要 PATH/temp/locale；模型凭据和 Node 注入选项不进入线程。 */
export function freezePluginWorkerEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined && OS_ENVIRONMENT_KEYS.has(key.toUpperCase())) result[key] = value;
  }
  return Object.freeze(result);
}
