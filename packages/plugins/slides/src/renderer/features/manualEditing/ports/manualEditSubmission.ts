import { inject, provide, type InjectionKey } from 'vue';
import type { ManualEditSubmissionPort } from '../definitions/manualEditQueue';

const submissionKey: InjectionKey<ManualEditSubmissionPort> = Symbol('slides-manual-edit-submission');

export function provideManualEditSubmission(port: ManualEditSubmissionPort): void {
  provide(submissionKey, port);
}

export function useManualEditSubmission(): ManualEditSubmissionPort {
  const port = inject(submissionKey);
  if (!port) throw new Error('Slides editing requires a document submission queue');
  return port;
}
