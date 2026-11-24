import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 已安装的正式 App：版本号、可执行文件与安装包里的随包插件目录。
 * macOS 传 `.app` 目录或其中的可执行文件；Windows 传安装目录里的 `林芽.exe`。
 */
export function readInstalledApp(appPath) {
  const resolved = path.resolve(appPath);
  assert.ok(existsSync(resolved), `App 不存在：${resolved}`);
  if (process.platform === 'darwin') {
    const bundle = resolved.endsWith('.app') ? resolved : path.resolve(path.dirname(resolved), '../..');
    const plist = readFileSync(path.join(bundle, 'Contents/Info.plist'), 'utf8');
    const value = key => plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`, 'u'))?.[1];
    const executableName = value('CFBundleExecutable');
    assert.ok(executableName, 'Info.plist 缺少 CFBundleExecutable');
    return {
      executable: path.join(bundle, 'Contents/MacOS', executableName),
      version: value('CFBundleShortVersionString'),
      bundledPluginRoot: path.join(bundle, 'Contents/Resources/plugins'),
    };
  }
  if (process.platform === 'win32') {
    assert.match(resolved, /\.exe$/iu, 'Windows 传安装目录里的可执行文件');
    const productVersion = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-Item -LiteralPath '${resolved.replaceAll("'", "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8' }).trim();
    // PE 的 ProductVersion 是四段（x.y.z.0），与 Electron 的三段应用版本指同一版本。
    const version = productVersion.replace(/^(\d+\.\d+\.\d+)\.0$/u, '$1');
    return { executable: resolved, version, bundledPluginRoot: path.join(path.dirname(resolved), 'resources', 'plugins') };
  }
  throw new Error(`unsupported platform ${process.platform}`);
}
