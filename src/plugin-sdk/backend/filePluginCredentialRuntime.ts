import fs from 'node:fs/promises';
import path from 'node:path';

import type { PluginCredentialRuntimePort, PluginCredentialStatus } from './pluginCredentialRuntime';

const FILE_VERSION = '1.0.0' as const;
const LEGACY_STORE_KEY = 'pluginCredentials';

interface CredentialProtectionPort {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

interface LegacyStoreLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

interface PluginCredentialFile {
  readonly version: typeof FILE_VERSION;
  readonly last_updated: string;
  readonly credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

type CredentialValues = Map<string, Map<string, string>>;

/**
 * File-backed plugin credentials. The file contains only safeStorage ciphertext;
 * plaintext values are kept in memory for the lifetime of the App Server.
 */
export async function createFilePluginCredentialRuntimePort(input: {
  readonly filePath: string;
  readonly credentialProtection: CredentialProtectionPort;
  readonly legacyStore?: LegacyStoreLike;
}): Promise<PluginCredentialRuntimePort> {
  const values = new Map<string, Map<string, string>>();
  const ciphertexts = new Map<string, Map<string, string>>();
  const unavailable = new Set<string>();
  let writeQueue: Promise<void> = Promise.resolve();
  await initialize(input, values, ciphertexts, unavailable);

  const enqueueWrite = <T>(task: () => Promise<T>): Promise<T> => {
    const run = writeQueue.then(task, task);
    writeQueue = run.then(() => undefined, () => undefined);
    return run;
  };

  return {
    async read(pluginId, key) {
      return values.get(pluginId)?.get(key);
    },
    async listStatus(pluginId, keys) {
      const pluginValues = values.get(pluginId);
      return keys.map(key => ({
        key,
        configured: pluginValues?.has(key) === true && !unavailable.has(`${pluginId}\u0000${key}`),
      }));
    },
    async write(pluginId, inputValues) {
      return enqueueWrite(async () => {
        const next = cloneValues(values);
        const nextCiphertexts = cloneValues(ciphertexts);
        const nextUnavailable = new Set(unavailable);
        const pluginValues = new Map(next.get(pluginId) ?? []);
        const pluginCiphertexts = new Map(nextCiphertexts.get(pluginId) ?? []);
        for (const [key, value] of Object.entries(inputValues)) {
          const trimmed = value?.trim();
          if (trimmed === undefined || trimmed.length === 0) {
            pluginValues.delete(key);
            pluginCiphertexts.delete(key);
            nextUnavailable.delete(`${pluginId}\u0000${key}`);
            continue;
          }
          // The encrypted file is written before the in-memory snapshot is replaced.
          pluginCiphertexts.set(key, await input.credentialProtection.encrypt(trimmed));
          pluginValues.set(key, trimmed);
          nextUnavailable.delete(`${pluginId}\u0000${key}`);
        }
        if (pluginValues.size === 0) next.delete(pluginId);
        else next.set(pluginId, pluginValues);
        if (pluginCiphertexts.size === 0) nextCiphertexts.delete(pluginId);
        else nextCiphertexts.set(pluginId, pluginCiphertexts);

        await writeCiphertextFile(input.filePath, nextCiphertexts);
        values.clear();
        for (const [id, entries] of next) values.set(id, new Map(entries));
        ciphertexts.clear();
        for (const [id, entries] of nextCiphertexts) ciphertexts.set(id, new Map(entries));
        unavailable.clear();
        for (const key of nextUnavailable) unavailable.add(key);
        return credentialStatuses(pluginValues, Object.keys(inputValues).sort(), unavailable, pluginId);
      });
    },
    async clearForTest(pluginId) {
      return enqueueWrite(async () => {
        const next = cloneValues(values);
        const nextCiphertexts = cloneValues(ciphertexts);
        next.delete(pluginId);
        nextCiphertexts.delete(pluginId);
        await writeCiphertextFile(input.filePath, nextCiphertexts);
        values.clear();
        for (const [id, entries] of next) values.set(id, new Map(entries));
        ciphertexts.clear();
        for (const [id, entries] of nextCiphertexts) ciphertexts.set(id, new Map(entries));
        unavailable.forEach(key => {
          if (key.startsWith(`${pluginId}\u0000`)) unavailable.delete(key);
        });
      });
    },
  };
}

async function initialize(
  input: {
    readonly filePath: string;
    readonly credentialProtection: CredentialProtectionPort;
    readonly legacyStore?: LegacyStoreLike;
  },
  values: CredentialValues,
  ciphertexts: CredentialValues,
  unavailable: Set<string>,
): Promise<void> {
  try {
    const parsed = parseFile(await fs.readFile(input.filePath, 'utf8'));
    for (const [pluginId, entries] of Object.entries(parsed.credentials)) {
      for (const [key, ciphertext] of Object.entries(entries)) {
        setValue(ciphertexts, pluginId, key, ciphertext);
      }
      for (const [key, ciphertext] of Object.entries(entries)) {
        try {
          const plaintext = await input.credentialProtection.decrypt(ciphertext);
          if (plaintext.trim().length > 0) setValue(values, pluginId, key, plaintext);
        } catch {
          unavailable.add(`${pluginId}\u0000${key}`);
        }
      }
    }
    return;
  } catch (error: unknown) {
    if (!isMissingFileError(error)) return;
  }

  const legacy = readLegacyValues(input.legacyStore?.get(LEGACY_STORE_KEY));
  if (legacy.size === 0) return;
  try {
    const encrypted = await encryptValues(legacy, input.credentialProtection);
    await writeCiphertextFile(input.filePath, encrypted);
    input.legacyStore?.set(LEGACY_STORE_KEY, {});
    for (const [pluginId, entries] of legacy) {
      for (const [key, value] of entries) {
        setValue(values, pluginId, key, value);
        setValue(ciphertexts, pluginId, key, encrypted.get(pluginId)?.get(key) ?? '');
      }
    }
  } catch {
    // Preserve the legacy value for a later retry, but never load it as usable plaintext.
  }
}

async function writeCiphertextFile(
  filePath: string,
  ciphertexts: CredentialValues,
): Promise<void> {
  const credentials: Record<string, Record<string, string>> = {};
  for (const [pluginId, entries] of ciphertexts) {
    const encryptedEntries: Record<string, string> = {};
    for (const [key, plaintext] of entries) {
      encryptedEntries[key] = plaintext;
    }
    if (Object.keys(encryptedEntries).length > 0) credentials[pluginId] = encryptedEntries;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const file: PluginCredentialFile = {
    version: FILE_VERSION,
    last_updated: new Date().toISOString(),
    credentials,
  };
  await fs.writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporaryPath, filePath);
}

async function encryptValues(
  values: CredentialValues,
  protection: CredentialProtectionPort,
): Promise<CredentialValues> {
  const ciphertexts = new Map<string, Map<string, string>>();
  for (const [pluginId, entries] of values) {
    const encryptedEntries = new Map<string, string>();
    for (const [key, plaintext] of entries) {
      encryptedEntries.set(key, await protection.encrypt(plaintext));
    }
    if (encryptedEntries.size > 0) ciphertexts.set(pluginId, encryptedEntries);
  }
  return ciphertexts;
}

function parseFile(raw: string): PluginCredentialFile {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== FILE_VERSION || !isRecord(parsed.credentials)) {
    throw new Error('plugin credential file schema invalid');
  }
  const credentials: Record<string, Record<string, string>> = {};
  for (const [pluginId, value] of Object.entries(parsed.credentials)) {
    if (!isRecord(value)) continue;
    const entries: Record<string, string> = {};
    for (const [key, ciphertext] of Object.entries(value)) {
      if (typeof ciphertext === 'string' && ciphertext.length > 0) entries[key] = ciphertext;
    }
    if (Object.keys(entries).length > 0) credentials[pluginId] = entries;
  }
  return {
    version: FILE_VERSION,
    last_updated: typeof parsed.last_updated === 'string' ? parsed.last_updated : '',
    credentials,
  };
}

function readLegacyValues(raw: unknown): CredentialValues {
  const result: CredentialValues = new Map();
  if (!isRecord(raw)) return result;
  for (const [pluginId, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    for (const [key, plaintext] of Object.entries(value)) {
      if (typeof plaintext === 'string' && plaintext.trim().length > 0) {
        setValue(result, pluginId, key, plaintext.trim());
      }
    }
  }
  return result;
}

function cloneValues(values: CredentialValues): CredentialValues {
  return new Map(Array.from(values, ([pluginId, entries]) => [pluginId, new Map(entries)]));
}

function setValue(values: CredentialValues, pluginId: string, key: string, value: string): void {
  const entries = values.get(pluginId) ?? new Map<string, string>();
  entries.set(key, value);
  values.set(pluginId, entries);
}

function credentialStatuses(
  values: ReadonlyMap<string, string>,
  keys: readonly string[],
  unavailable: ReadonlySet<string>,
  pluginId: string,
): readonly PluginCredentialStatus[] {
  return keys.map(key => ({
    key,
    configured: values.has(key) && !unavailable.has(`${pluginId}\u0000${key}`),
  }));
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
