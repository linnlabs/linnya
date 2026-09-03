import path from 'node:path';

const PLUGIN_CLI_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;

export function requirePluginCliId(value: string): string {
  if (!PLUGIN_CLI_ID_PATTERN.test(value) || value.length > 128) {
    throw new Error('Plugin CLI launcher requires a valid plugin id.');
  }
  return value;
}

export function resolvePluginCliCommandName(pluginId: string): string {
  return `linnya-${requirePluginCliId(pluginId)}`;
}

export function resolvePluginCliLauncherFileName(
  pluginId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const commandName = resolvePluginCliCommandName(pluginId);
  return platform === 'win32' ? `${commandName}.exe` : commandName;
}

export function resolvePluginCliLauncherPath(
  directory: string,
  pluginId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(directory, resolvePluginCliLauncherFileName(pluginId, platform));
}
