import type { DesktopCredentialProtectionPort } from '../definitions/desktopCredentialProtectionPort';

let installedPort: DesktopCredentialProtectionPort | null = null;

export function installDesktopCredentialProtectionPort(
  port: DesktopCredentialProtectionPort,
): void {
  if (installedPort && installedPort !== port) {
    throw new Error('Desktop credential protection 当前 App owner 已安装另一实现');
  }
  installedPort = port;
}

export function getDesktopCredentialProtectionPort(): DesktopCredentialProtectionPort {
  if (!installedPort) {
    throw new Error('Desktop credential protection 尚未由 App composition 安装');
  }
  return installedPort;
}

export function clearDesktopCredentialProtectionPortForTesting(): void {
  installedPort = null;
}
