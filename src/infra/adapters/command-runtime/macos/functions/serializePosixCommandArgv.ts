function quotePosixArgument(argument: string): string {
  if (argument.includes('\0')) {
    throw new Error('POSIX command arguments cannot contain NUL');
  }
  return `'${argument.split("'").join(`'"'"'`)}'`;
}

/**
 * SRT 的公开接口接收 Shell 文本，而 Linnya 的启动合同是 executable + argv。
 * 这里逐项单引号编码，避免把已经冻结的参数重新解释成管道、变量或命令替换。
 */
export function serializePosixCommandArgv(
  executablePath: string,
  argv: readonly string[],
  // SRT 用 env 前缀覆盖 TMPDIR，覆盖项必须在其后的 Shell 文本里导出才会生效。
  environmentOverrides: Readonly<Record<string, string>> = {},
): string {
  const exports = Object.entries(environmentOverrides).map(
    ([name, value]) => `export ${name}=${quotePosixArgument(value)}; `,
  );
  return `${exports.join('')}${['exec', executablePath, ...argv].map(quotePosixArgument).join(' ')}`;
}
