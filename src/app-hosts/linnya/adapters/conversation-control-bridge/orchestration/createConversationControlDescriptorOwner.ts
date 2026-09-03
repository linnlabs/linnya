import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  CONVERSATION_CONTROL_PROTOCOL_VERSION,
  ConversationControlConnectionDescriptorSchema,
  type ConversationControlConnectionDescriptor,
} from '@app/schemas';
import type { ConversationControlDescriptorOwner } from '../definitions/conversationControlBridge';

interface ConversationControlDescriptorOwnerOptions {
  readonly connectionFile: string;
  readonly appInstanceId: string;
  readonly sessionToken: string;
  readonly pid: number;
  readonly now?: () => number;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function writePrivateJsonAtomically(
  destination: string,
  value: ConversationControlConnectionDescriptor,
): Promise<void> {
  const directory = path.dirname(destination);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);

  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600);
  } catch (error: unknown) {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function readDescriptor(
  connectionFile: string,
): Promise<ConversationControlConnectionDescriptor | null> {
  try {
    const content = await fs.readFile(connectionFile, 'utf8');
    const decoded: unknown = JSON.parse(content);
    const parsed = ConversationControlConnectionDescriptorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch (error: unknown) {
    if (isMissingFile(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** 连接描述的唯一 owner：发布时原子替换，退出时只撤销自己的 App 实例。 */
export function createConversationControlDescriptorOwner(
  options: ConversationControlDescriptorOwnerOptions,
): ConversationControlDescriptorOwner {
  const now = options.now ?? Date.now;
  let createdAt: number | undefined;

  return {
    async publish(port) {
      const timestamp = now();
      createdAt ??= timestamp;
      const descriptor = ConversationControlConnectionDescriptorSchema.parse({
        protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
        app_instance_id: options.appInstanceId,
        pid: options.pid,
        host: '127.0.0.1',
        port,
        session_token: options.sessionToken,
        created_at: createdAt,
        updated_at: timestamp,
      });
      await writePrivateJsonAtomically(options.connectionFile, descriptor);
      return descriptor;
    },

    async revoke() {
      const current = await readDescriptor(options.connectionFile);
      if (!current || current.app_instance_id !== options.appInstanceId) return false;
      try {
        await fs.unlink(options.connectionFile);
        return true;
      } catch (error: unknown) {
        if (isMissingFile(error)) return false;
        throw error;
      }
    },
  };
}
