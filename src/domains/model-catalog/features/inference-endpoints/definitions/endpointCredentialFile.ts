export const ENDPOINT_CREDENTIAL_FILE_VERSION = '1.0.0';

export interface StoredEndpointCredential {
  readonly id: string;
  readonly encrypted_secret: string;
}

export interface EndpointCredentialFile {
  readonly version: typeof ENDPOINT_CREDENTIAL_FILE_VERSION;
  readonly last_updated: string;
  readonly credentials: readonly StoredEndpointCredential[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readEndpointCredentialFile(value: unknown): readonly StoredEndpointCredential[] {
  if (!isRecord(value) || value.version !== ENDPOINT_CREDENTIAL_FILE_VERSION) {
    throw new Error(`endpoint_credentials.json version 必须是 ${ENDPOINT_CREDENTIAL_FILE_VERSION}`);
  }
  if (typeof value.last_updated !== 'string' || !Array.isArray(value.credentials)) {
    throw new Error('endpoint_credentials.json envelope 无效');
  }
  return value.credentials.map((credential, index) => {
    if (!isRecord(credential)) {
      throw new Error(`endpoint_credentials.json.credentials[${index}] 必须是对象`);
    }
    if (
      typeof credential.id !== 'string' ||
      !credential.id.trim() ||
      typeof credential.encrypted_secret !== 'string' ||
      !credential.encrypted_secret
    ) {
      throw new Error(`endpoint_credentials.json.credentials[${index}] 无效`);
    }
    return { id: credential.id, encrypted_secret: credential.encrypted_secret };
  });
}
