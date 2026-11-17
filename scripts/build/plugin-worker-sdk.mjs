import path from 'node:path';

/** Worker isolate 没有主线程 require hook；这些窄 SDK 必须实际内联。 */
export function pluginWorkerSdkAliases(repositoryRoot) {
  return Object.fromEntries(
    ['inferenceRuntime', 'databaseRuntime', 'documentParsingRuntime', 'loggingRuntime'].map(name => [
      `@plugin/backend/worker/${name}`,
      path.join(repositoryRoot, 'src/plugin-sdk/backend/worker', `${name}.ts`),
    ])
  );
}
