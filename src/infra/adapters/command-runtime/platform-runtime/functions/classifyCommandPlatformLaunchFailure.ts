const PAYLOAD_ERROR_CODES: ReadonlySet<string> = new Set([
  'E2BIG',
  'ENAMETOOLONG',
]);

function isWindowsNativeCommandLineBudgetError(error: Error): boolean {
  // Windows native runtime 在 CreateProcessW 前按最终序列化结果检查 32,767 个
  // UTF-16 单元。N-API 当前只保留受控错误正文，因此这里必须匹配完整 stage 与单位，
  // 不能把其他 native 参数错误或普通 child 错误误报成启动载荷过大。
  return error.message.includes('windows_process_owner stage=command_line')
    && error.message.includes('payload has ')
    && error.message.includes(' UTF-16 units; maximum including NUL is 32767');
}

/**
 * 把平台 owner 的真实启动错误收敛成跨平台稳定分类。这里只遍历我们自己的 cause
 * 包装链；用户命令输出和 Shell exit 永远不会进入这条 pre-launch 通道。
 */
export function classifyCommandPlatformLaunchFailure(
  error: unknown,
): 'launch_payload_too_large' | undefined {
  const visited = new Set<Error>();
  let current: unknown = error;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (
      ('code' in current && typeof current.code === 'string'
        && PAYLOAD_ERROR_CODES.has(current.code))
      || isWindowsNativeCommandLineBudgetError(current)
    ) {
      return 'launch_payload_too_large';
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}
