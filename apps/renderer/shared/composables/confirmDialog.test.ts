import { describe, expect, it } from 'vitest';
import {
  cancelConfirmDialog,
  confirm,
  confirmDialogState,
} from './confirmDialog';

describe('confirmDialog', () => {
  it('leaves default chrome text to AlertDialog localization', async () => {
    const resultPromise = confirm({ message: 'Delete item?' });

    expect(confirmDialogState.title).toBe('');
    expect(confirmDialogState.confirmText).toBe('');
    expect(confirmDialogState.cancelText).toBe('');

    cancelConfirmDialog();
    await expect(resultPromise).resolves.toBe(false);
  });
});
