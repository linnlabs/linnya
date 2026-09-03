import type { DesktopRasterPdfDocumentPort } from '../definitions/desktopRasterPdfDocumentPort';

let installedPort: DesktopRasterPdfDocumentPort | null = null;

export function installDesktopRasterPdfDocumentPort(
  port: DesktopRasterPdfDocumentPort,
): void {
  if (installedPort && installedPort !== port) {
    throw new Error('Desktop raster PDF 当前 App owner 已安装另一实现');
  }
  installedPort = port;
}

export function getDesktopRasterPdfDocumentPort(): DesktopRasterPdfDocumentPort {
  if (!installedPort) {
    throw new Error('Desktop raster PDF 尚未由 App composition 安装');
  }
  return installedPort;
}

export function clearDesktopRasterPdfDocumentPortForTesting(): void {
  installedPort = null;
}
