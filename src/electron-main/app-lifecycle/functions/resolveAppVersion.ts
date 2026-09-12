/**
 * 开发命令直接启动 Main bundle，Electron 的 getVersion() 此时代表 Electron，而非 Linnya。
 * 产品版本由正式开发启动器从 manifest 注入；发布包只信任自身版本，不允许环境变量覆盖。
 */
export function resolveAppVersion(input: {
  readonly packaged: boolean;
  readonly electronApplicationVersion: string;
  readonly developmentApplicationVersion: string | undefined;
}): string {
  if (input.packaged) return input.electronApplicationVersion;

  const version = input.developmentApplicationVersion?.trim();
  if (!version) {
    throw new Error(
      '源码运行缺少 APP_VERSION；请通过 pnpm run dev:electron 或 pnpm run start:electron 启动。',
    );
  }
  return version;
}
