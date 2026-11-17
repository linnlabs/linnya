import path from 'node:path';

/** Worker isolate 没有主线程 require hook；这些窄 SDK 必须实际内联。 */
export function pluginWorkerSdkAliases(repositoryRoot) {
  const aliases = Object.fromEntries(
    ['inferenceRuntime', 'databaseRuntime', 'documentParsingRuntime', 'loggingRuntime'].map(name => [
      `@plugin/backend/worker/${name}`,
      path.join(repositoryRoot, 'src/plugin-sdk/backend/worker', `${name}.ts`),
    ])
  );
  // 同一插件的共享模块也会用主线程 specifier；仅 Worker 构建将其绑定到相同的内联运行域。
  for (const name of ['loggingRuntime', 'documentParsingRuntime']) {
    aliases[`@plugin/backend/${name}`] = aliases[`@plugin/backend/worker/${name}`];
  }
  aliases['@plugin/backend/textSegmentationRuntime'] = path.join(repositoryRoot, 'src/plugin-sdk/backend/textSegmentationRuntime.ts');
  aliases['@plugin/backend/inferenceFailures'] = path.join(repositoryRoot, 'src/plugin-sdk/backend/inferenceFailures.ts');
  return aliases;
}
