import { describe, expect, it } from 'vitest';
import { commandReferencesCredentialPath } from '../functions/commandReferencesCredentialPath';

describe('可见凭据路径风险提示', () => {
  const macos = {
    credentialFilePath: '/Users/test/Library/Application Support/linnya/AIService/config/credentials.json',
    cwd: '/work', context: { platform: 'macos', shellSemanticsId: 'zsh' },
  } as const;
  const windows = {
    credentialFilePath: String.raw`C:\Users\test\AppData\Roaming\linnya\AIService\config\credentials.json`,
    cwd: String.raw`C:\work`, context: { platform: 'windows', shellSemanticsId: 'powershell-5.1' },
  } as const;

  it('识别含空格的文件路径、目录，以及命令中直接写出的脚本字符串', () => {
    for (const command of [
      `cat "${macos.credentialFilePath}"`,
      'ls "/Users/test/Library/Application Support/linnya/AIService/config"',
      `node -e 'require("fs").readFileSync("${macos.credentialFilePath}")'`,
      `node -e 'console.log("/Users/test/Library/Application Support/linnya/AIService/config-backup"); require("fs").readFileSync("${macos.credentialFilePath}")'`,
    ]) expect(commandReferencesCredentialPath({ ...macos, command })).toBe(true);
  });

  it('相对参数按本次 cwd 判断，文件尚不存在也不需要读取磁盘', () => {
    expect(commandReferencesCredentialPath({
      ...macos, cwd: '/Users/test/Library/Application Support/linnya/AIService',
      command: 'cat config/credentials.json',
    })).toBe(true);
    expect(commandReferencesCredentialPath({ ...macos, command: 'cat config/credentials.json' })).toBe(false);
  });

  it('Windows 路径忽略大小写并接受斜杠和反斜杠', () => {
    for (const command of [
      `Get-Content '${windows.credentialFilePath.toUpperCase()}'`,
      'Get-Content C:/Users/test/AppData/Roaming/linnya/AIService/config/credentials.json',
      String.raw`node -e 'require("fs").readFileSync("C:\\Users\\test\\AppData\\Roaming\\linnya\\AIService\\config\\credentials.json")'`,
    ]) expect(commandReferencesCredentialPath({ ...windows, command })).toBe(true);
  });

  it('不会把相邻同名前缀目录、普通工作文件或不透明脚本当成已识别的凭据读取', () => {
    for (const command of [
      'cat "/Users/test/Library/Application Support/linnya/AIService/config-backup/readme.md"',
      'cat ./credentials.json', 'node reader.js', 'python -c "run_saved_program()"',
    ]) expect(commandReferencesCredentialPath({ ...macos, command })).toBe(false);
  });
});
