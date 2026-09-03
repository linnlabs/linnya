import { parseToolOutputBlobId } from '@app/schemas';

import type {
  CommandSettledTextOutput,
  CommandSettledTextResource,
} from '../../../../../../domains/commands';
import { createUnavailableCommandSettledTextOutput } from '../../../../../../domains/commands';
import type { PipeCommandOutputSettlement } from '../definitions/pipeCommandOutputSession';
import type { PipeCommandTextBlobSettlement } from '../definitions/pipeCommandTextSink';
import type { PtyCommandOutputSettlement } from '../definitions/ptyCommandOutputSession';
import type { PtyCommandTextBlobSettlement } from '../definitions/ptyCommandTextSink';

type TextBlobSettlement = PipeCommandTextBlobSettlement | PtyCommandTextBlobSettlement;

function projectResource(settlement: TextBlobSettlement): CommandSettledTextResource {
  if (settlement.status === 'published') {
    return Object.freeze({
      status: 'published',
      completeness: settlement.completeness,
      blobId: parseToolOutputBlobId(settlement.blob.blobId),
      persistedCharacters: settlement.persistedCharacters,
      persistedLines: settlement.persistedLines,
    });
  }
  if (settlement.status === 'not_created') {
    return Object.freeze({ status: 'not_created', reason: settlement.reason });
  }
  return Object.freeze({ status: 'unavailable' });
}

export function projectPipeCommandSettledTextOutput(
  settlement: PipeCommandOutputSettlement,
): CommandSettledTextOutput {
  return Object.freeze({
    mode: 'pipe',
    stdout: projectResource(settlement.text.streams.stdout.blob),
    stderr: projectResource(settlement.text.streams.stderr.blob),
  });
}

export function projectUnavailablePipeCommandSettledTextOutput(): CommandSettledTextOutput {
  return createUnavailableCommandSettledTextOutput('pipe');
}

export function projectPtyCommandSettledTextOutput(
  settlement: PtyCommandOutputSettlement,
): CommandSettledTextOutput {
  return Object.freeze({
    mode: 'pty',
    terminal: projectResource(settlement.text.blob),
  });
}

export function projectUnavailablePtyCommandSettledTextOutput(): CommandSettledTextOutput {
  return createUnavailableCommandSettledTextOutput('pty');
}
