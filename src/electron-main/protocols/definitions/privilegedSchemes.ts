import type { CustomScheme } from 'electron';

export const PLUGIN_PROTOCOL_SCHEME = 'plugin';
export const MEDIA_PROTOCOL_SCHEME = 'media';

export function getPluginProtocolPrivilegedScheme(): CustomScheme {
  return {
    scheme: PLUGIN_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  };
}

export function getMediaProtocolPrivilegedScheme(): CustomScheme {
  return {
    scheme: MEDIA_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
      bypassCSP: false,
    },
  };
}
