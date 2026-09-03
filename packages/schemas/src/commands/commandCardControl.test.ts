import { describe, expect, it } from 'vitest';

import {
  CommandProtectedInputSubmissionV1Schema,
  CommandProtectedInputValueSchema,
} from './commandCardControl';

describe('command protected input wire contract', () => {
  it('按 UTF-8 byte 限制单次输入，允许空值但拒绝超出 64 KiB', () => {
    expect(CommandProtectedInputValueSchema.safeParse('').success).toBe(true);
    expect(CommandProtectedInputValueSchema.safeParse('你'.repeat(21_845)).success).toBe(true);
    expect(CommandProtectedInputValueSchema.safeParse('你'.repeat(21_846)).success).toBe(false);
  });

  it('submission 只接受页面票据、保护输入票据和正文，不允许 renderer 自报 owner', () => {
    const submission = {
      page_ticket: 'command_control_page_00000000-0000-4000-8000-000000000001',
      protected_input_ticket: 'command_protected_input_ticket_00000000-0000-4000-8000-000000000002',
      input: 'private-value',
    };
    expect(CommandProtectedInputSubmissionV1Schema.safeParse(submission).success).toBe(true);
    expect(CommandProtectedInputSubmissionV1Schema.safeParse({
      ...submission,
      owner_id: 99,
    }).success).toBe(false);
  });
});
