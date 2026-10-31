import type { CommandLaunchEnvironmentV1, CommandPermissionSnapshotV1 } from '@app/schemas/commands';

/** 文件隔离不能阻止 printenv；只移除 Host 已声明为凭据的变量，不猜测用户变量名。 */
export function resolveShellCredentialEnvironment(input: {
  readonly environment: CommandLaunchEnvironmentV1;
  readonly permission: CommandPermissionSnapshotV1;
  readonly credentialVariableNames: readonly string[];
  readonly platform: 'macos' | 'windows';
}): CommandLaunchEnvironmentV1 {
  if (input.permission.effective_level === 'full_access' || input.permission.internal_storage_access) {
    return input.environment;
  }
  const normalize = (name: string) => input.platform === 'windows' ? name.toUpperCase() : name;
  const credentialNames = new Set(input.credentialVariableNames.map(normalize));
  return {
    ...input.environment,
    entries: Object.fromEntries(Object.entries(input.environment.entries).filter(
      ([name]) => !credentialNames.has(normalize(name)),
    )),
  };
}
