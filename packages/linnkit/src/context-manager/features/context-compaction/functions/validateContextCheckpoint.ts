import {
  CONTEXT_CHECKPOINT_CLOSE_TAG,
  CONTEXT_CHECKPOINT_OPEN_TAG,
  CONTEXT_CHECKPOINT_SECTION_HEADINGS,
  type ContextCheckpointValidationResult,
} from '../definitions/contextCheckpointFormat';

const INSTRUCTION_LIKE_LINE = /^(?:忽略|无视|从现在起你(?:必须|应当)|你必须|不要再遵守|ignore\s+(?:all\s+|any\s+)?(?:previous|prior)|you\s+must\b)/imu;

export function validateContextCheckpoint(input: {
  readonly content: string;
  readonly maxOutputTokens: number;
  readonly estimateTextTokens: (text: string) => number;
}): ContextCheckpointValidationResult {
  const content = input.content.trim();
  const tokenEstimate = input.estimateTextTokens(content);
  if (
    !content.startsWith(CONTEXT_CHECKPOINT_OPEN_TAG)
    || !content.endsWith(CONTEXT_CHECKPOINT_CLOSE_TAG)
    || content.indexOf(CONTEXT_CHECKPOINT_OPEN_TAG) !== content.lastIndexOf(CONTEXT_CHECKPOINT_OPEN_TAG)
    || content.indexOf(CONTEXT_CHECKPOINT_CLOSE_TAG) !== content.lastIndexOf(CONTEXT_CHECKPOINT_CLOSE_TAG)
  ) {
    return { valid: false, reason: 'invalid_envelope', tokenEstimate };
  }
  if (tokenEstimate > input.maxOutputTokens) {
    return { valid: false, reason: 'output_too_large', tokenEstimate };
  }

  let previousEndIndex = CONTEXT_CHECKPOINT_OPEN_TAG.length;
  for (const heading of CONTEXT_CHECKPOINT_SECTION_HEADINGS) {
    const headingIndex = content.indexOf(heading);
    if (headingIndex < 0) {
      return { valid: false, reason: 'missing_section', tokenEstimate };
    }
    if (
      headingIndex < previousEndIndex
      || content.indexOf(heading, headingIndex + heading.length) >= 0
    ) {
      return { valid: false, reason: 'invalid_section_order', tokenEstimate };
    }
    previousEndIndex = headingIndex + heading.length;
  }

  for (let index = 0; index < CONTEXT_CHECKPOINT_SECTION_HEADINGS.length; index += 1) {
    const heading = CONTEXT_CHECKPOINT_SECTION_HEADINGS[index];
    const sectionStart = content.indexOf(heading) + heading.length;
    const nextHeading = CONTEXT_CHECKPOINT_SECTION_HEADINGS[index + 1];
    const sectionEnd = nextHeading
      ? content.indexOf(nextHeading)
      : content.lastIndexOf(CONTEXT_CHECKPOINT_CLOSE_TAG);
    const body = content.slice(sectionStart, sectionEnd).trim();
    if (body.length === 0) {
      return { valid: false, reason: 'empty_section', tokenEstimate };
    }
    if (INSTRUCTION_LIKE_LINE.test(body)) {
      return { valid: false, reason: 'instruction_like_content', tokenEstimate };
    }
  }

  return { valid: true, content, tokenEstimate };
}
