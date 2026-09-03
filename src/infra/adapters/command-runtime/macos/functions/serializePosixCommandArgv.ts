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
): string {
  return ['exec', executablePath, ...argv].map(quotePosixArgument).join(' ');
}
