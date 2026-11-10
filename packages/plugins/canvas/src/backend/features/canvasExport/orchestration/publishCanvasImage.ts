import { promises as fs } from 'node:fs';
import path from 'node:path';
import { formatConversationFileLocator } from '@app/schemas';

/** 只在Host授权的conversation目录内创建本次独占产物；不接受模型提供的输出路径。 */
export async function publishCanvasImage(input: {
  readonly conversationRoot: string;
  readonly bytes: Uint8Array;
  readonly format: 'png' | 'jpeg';
  readonly signal: AbortSignal;
  readonly assertScope: () => void;
}) {
  input.signal.throwIfAborted();
  input.assertScope();
  const root = await fs.realpath(input.conversationRoot);
  const directory = await fs.mkdtemp(path.join(root, 'canvas-render-'));
  try {
    const fileName = `canvas.${input.format}`;
    await fs.writeFile(path.join(directory, fileName), input.bytes, {
      flag: 'wx',
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    input.assertScope();
    return formatConversationFileLocator(`${path.basename(directory)}/${fileName}`);
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
