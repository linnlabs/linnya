import { z } from 'zod';
import { CommandToolOutputDisplaySchema } from '@app/schemas';
const shellFacts = z.object({
  status: z.literal('completed'),
  presentationText: z.string(),
  display: CommandToolOutputDisplaySchema,
  terminal: z.object({ outcome: z.literal('exited'), exitCode: z.number() }),
  command_output_store: z.object({
    stdout: z.object({ status: z.literal('published'), completeness: z.literal('complete') }),
  }),
});
/** 只接纳已关闭且完整的正式pipe投影；不能从截断输出推断校验或提交成功。 */
export function readCompleteShellOutput(value: unknown) {
  const parsed = shellFacts.safeParse(value);
  if (!parsed.success) return null;
  const facts = parsed.data;
  if (
    facts.display.mode !== 'pipe' ||
    facts.display.coverage !== 'complete' ||
    facts.display.outputPhase !== 'closed' ||
    facts.display.textProjection !== 'available' ||
    facts.display.incompleteReasons?.length
  )
    return null;
  if (!facts.presentationText.startsWith('stdout:\n')) return null;
  const stdout = facts.presentationText.slice('stdout:\n'.length).split('\n\nstderr:\n')[0];
  const objects: unknown[] = [];
  let unknownLines = false;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line || line === '---' || line.startsWith('== ')) continue;
    if (!line.startsWith('{')) {
      unknownLines = true;
      continue;
    }
    try {
      const value: unknown = JSON.parse(line);
      objects.push(value);
    } catch {
      unknownLines = true;
    }
  }
  return { objects, unknownLines, exitCode: facts.terminal.exitCode };
}
