import type { IpcRenderer } from 'electron';

type MediaOperation = 'image' | 'generated-image' | 'audio';

const mediaLoadPrefix = 'media://load';

function encodePathForMediaUrl(filePath: string): string {
  const bytes = new TextEncoder().encode(filePath);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMediaUrl(operation: MediaOperation, filePath: string): string {
  return `${mediaLoadPrefix}/${operation}/${encodePathForMediaUrl(filePath)}`;
}

function getFileNameFromPath(filePath: string): string {
  return filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
}

export function buildMediaUrlPreloadApi(_ipcRenderer: IpcRenderer) {
  return {
    buildImageUrl: (filePath: string) => buildMediaUrl('image', filePath),
    buildGeneratedImageUrl: (imagePath: string) => buildMediaUrl('generated-image', imagePath),
    buildAudioUrl: (filePath: string) => buildMediaUrl('audio', filePath),
    getFileName: getFileNameFromPath,
  };
}
