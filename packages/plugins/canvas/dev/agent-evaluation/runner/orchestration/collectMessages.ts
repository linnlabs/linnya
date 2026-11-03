import { ConversationControlMessagesResponseSchema } from '@app/schemas';
import type { EvaluationRunnerPorts } from '../definitions/evaluationRunner';
import { writeEvidence } from '../adapters/evidenceFiles';

/** 向前读取全部正式窗口，不能只用最后200条而丢掉首写失败。 */
export async function collectEvaluationMessages(input: {
  readonly conversationId: string;
  readonly repositoryRoot: string;
  readonly directory: string;
  readonly ports: EvaluationRunnerPorts;
}) {
  let cursor: number | undefined,
    page = 0;
  const files: string[] = [];
  while (true) {
    const label = `messages-${++page}`;
    const result = await input.ports.cli({
      repositoryRoot: input.repositoryRoot,
      directory: input.directory,
      label,
      args: [
        'messages',
        input.conversationId,
        '--limit',
        '200',
        ...(cursor === undefined ? [] : ['--before', String(cursor)]),
      ],
    });
    if (result.exitCode !== 0) throw new Error('Messages CLI failed; raw evidence retained');
    const response = ConversationControlMessagesResponseSchema.parse(result.value);
    files.push(label + '.response.json');
    if (response.status === 'preparing') {
      await writeEvidence(input.directory, 'messages-index.json', {
        complete: false,
        reason: 'projection_preparing',
        files,
      });
      return false;
    }
    if (!response.has_more_before) {
      await writeEvidence(input.directory, 'messages-index.json', { complete: true, files });
      return true;
    }
    if (
      response.prev_cursor === undefined ||
      (cursor !== undefined && response.prev_cursor >= cursor)
    )
      throw new Error('Message pagination did not advance');
    cursor = response.prev_cursor;
  }
}
