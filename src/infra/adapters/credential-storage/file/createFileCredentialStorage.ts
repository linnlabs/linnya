import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { JsonValueSchema } from '@app/schemas';
import {
  CredentialStorageError,
  type CredentialStoragePort,
} from '../../../../shared/credential-storage';
import { restrictCredentialFileAccess } from './functions/restrictCredentialFileAccess';

const FileSchema = z
  .object({
    version: z.literal(1),
    namespaces: z.record(z.string(), z.record(z.string(), JsonValueSchema)),
  })
  .strict();

/** 每次更新只合并指定记录，其他 domain/进程的凭据不从旧内存快照重写。 */
export function createFileCredentialStorage(filePath: string): CredentialStoragePort {
  let existed = false;
  let readFailure: CredentialStorageError | undefined;
  function readFile(): z.infer<typeof FileSchema> {
    if (readFailure) throw readFailure;
    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf8');
      existed = true;
    } catch (error: unknown) {
      if (!existed && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { version: 1, namespaces: {} };
      }
      readFailure = new CredentialStorageError('unreadable');
      throw readFailure;
    }
    try {
      return FileSchema.parse(JSON.parse(text));
    } catch {
      readFailure = new CredentialStorageError('invalid_format');
      throw readFailure;
    }
  }
  readFile();
  return {
    read(namespace) {
      return new Map(Object.entries(readFile().namespaces[namespace] ?? {}));
    },
    async update(namespace, changes) {
      // 在任何写入前检查已知读取故障；不得用空文件覆盖损坏或被移走的原件。
      readFile();
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      let descriptor: number | undefined;
      let connection: Database.Database | undefined;
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
        await restrictCredentialFileAccess(temporaryPath);
        connection = new Database(path.join(path.dirname(filePath), '.credentials-write.lock'), {
          timeout: 5_000,
        });
        connection.exec('BEGIN EXCLUSIVE');
        // 锁内保持同步，避免同一事件循环的另一个 writer 阻塞正在持锁的 await。
        const current = readFile();
        const entries = new Map(Object.entries(current.namespaces[namespace] ?? {}));
        for (const [key, value] of changes) {
          if (value === undefined) entries.delete(key);
          else entries.set(key, value);
        }
        const namespaces = new Map(Object.entries(current.namespaces));
        if (entries.size === 0) namespaces.delete(namespace);
        else namespaces.set(namespace, Object.fromEntries(entries));
        const next = FileSchema.parse({ version: 1, namespaces: Object.fromEntries(namespaces) });
        fs.writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.renameSync(temporaryPath, filePath);
        existed = true;
      } catch (error: unknown) {
        if (error instanceof CredentialStorageError) throw error;
        throw new CredentialStorageError('write_failed');
      } finally {
        connection?.close();
        if (descriptor !== undefined) fs.closeSync(descriptor);
        fs.rmSync(temporaryPath, { force: true });
      }
    },
  };
}
