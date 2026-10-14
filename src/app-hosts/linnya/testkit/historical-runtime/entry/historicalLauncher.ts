import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runCliRuntimeHost } from '../../../cli-runtime/orchestration/runCliRuntimeHost';
import { createSystemCredentialProtectionPort } from 'src/infra/adapters/credential-protection/system-keyring';

// 开发入口只监督正式 Backend，不实现自己的 Agent loop 或协议。
async function main(): Promise<void> {
  const configFile = process.argv[2];
  if (!configFile) throw new Error('Usage: historical-launcher <runtime-config.json>');
  const config: unknown = JSON.parse(readFileSync(configFile, 'utf8'));
  if (
    !config ||
    typeof config !== 'object' ||
    !('workspaceRoot' in config) ||
    typeof config.workspaceRoot !== 'string'
  )
    throw new Error('Runtime config lacks workspaceRoot');
  const workspaceRoot = path.resolve(config.workspaceRoot);
  const outputRoot = path.dirname(path.resolve(configFile));
  if (
    existsSync(path.join(outputRoot, 'host-ready.json')) ||
    existsSync(path.join(outputRoot, 'connection.json'))
  )
    throw new Error(
      'Historical launcher refuses an output directory with an existing Host identity'
    );
  mkdirSync(workspaceRoot, { recursive: false });
  const pluginRoot = path.join(outputRoot, `empty-plugins-${path.basename(workspaceRoot)}`);
  mkdirSync(pluginRoot, { recursive: false });
  const repositoryRoot = process.cwd();
  const developmentRoot = path.join(outputRoot, 'host-root');
  await runCliRuntimeHost({
    developmentRoot,
    mainBundleDirectory: path.join(developmentRoot, 'dist', 'main'),
    credentialProtection: createSystemCredentialProtectionPort({
      vaultId: path.join(repositoryRoot, '_dev_data'),
      allowMasterKeyCreation: false,
    }),
    applicationVersion: '0.0.38',
    workspaceRootOverride: workspaceRoot,
    apiPort: 0,
    qdrantPort: 16433,
    processEnvironment: {
      ...process.env,
      LINNYA_PLUGIN_ROOT: pluginRoot,
      MODEL_REGISTRY_DEFAULTS_PATH: path.join(developmentRoot, 'default_models.json'),
      LINNYA_AUDIT_LEVEL: 'response',
      LINNYA_CLI_CONNECTION_FILE: path.join(outputRoot, 'connection.json'),
    },
    stderrSink: process.stderr,
    onReady(identity) {
      writeFileSync(
        path.join(outputRoot, 'host-ready.json'),
        JSON.stringify(identity, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 }
      );
    },
  });
}
void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
