import path from 'node:path';
import { app } from 'electron';
import {
  LINNYA_PLUGIN_CLI_COMMAND_MODE_MARKER,
  LINNYA_PLUGIN_RUNTIME_DATABASE_PATH_ENV,
  LINNYA_PLUGIN_ROOT_ENV,
} from 'src/domains/commands/definitions/internalCommandMode';
import { installPluginCliHostModuleResolver } from 'src/domains/commands/features/host-module-resolution/infrastructure/installPluginCliHostModuleResolver';
import {
  discoverDevelopmentPluginDirs,
  readDirectPluginDirsFromEnv,
  resolvePluginEntryById,
} from './plugins/loader/pluginLayout.ts';
import { readPluginRuntimeEnabled } from './commands/production-runtime/functions/readPluginRuntimeEnabled.ts';

const COMMAND_MODE_INVALID_REQUEST_EXIT_CODE = 2;

function resolvePluginCliEntry(pluginId) {
  if (!readPluginRuntimeEnabled({
    databasePath: process.env[LINNYA_PLUGIN_RUNTIME_DATABASE_PATH_ENV] ?? '',
    pluginId,
  })) {
    return null;
  }

  if (app.isPackaged) {
    const pluginRoot = process.env[LINNYA_PLUGIN_ROOT_ENV];
    if (!pluginRoot) return null;
    return resolvePluginEntryById({
      pluginRoot,
      pluginId,
      entryName: 'command',
    });
  }

  const directPluginDirs = [
    ...readDirectPluginDirsFromEnv(),
    ...discoverDevelopmentPluginDirs(path.resolve(__dirname, '../../packages/plugins')),
  ];
  return resolvePluginEntryById({
    pluginId,
    entryName: 'command',
    directPluginDirs,
  });
}

/**
 * 内部 Plugin CLI 模式只接受宿主发现的插件 ID。真实脚本路径由宿主决定，不能由调用方传入。
 */
export function tryStartPluginCliMode() {
  const markerIndex = process.argv.indexOf(LINNYA_PLUGIN_CLI_COMMAND_MODE_MARKER);
  if (markerIndex < 0) {
    return false;
  }

  const commandId = process.argv[markerIndex + 1];
  const cliEntry = commandId ? resolvePluginCliEntry(commandId) : null;
  if (!cliEntry) {
    process.stderr.write('plugin.cli.command_unavailable: Plugin CLI is unavailable\n');
    app.exit(COMMAND_MODE_INVALID_REQUEST_EXIT_CODE);
    return true;
  }

  const forwardedArgs = process.argv.slice(markerIndex + 2);
  process.argv = [process.argv[0], cliEntry, ...forwardedArgs];
  installPluginCliHostModuleResolver({
    pluginCliDirectory: path.dirname(cliEntry),
    hostAppRoot: app.getAppPath(),
  });
  require(cliEntry);
  return true;
}
