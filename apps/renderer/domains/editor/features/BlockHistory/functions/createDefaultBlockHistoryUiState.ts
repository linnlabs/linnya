import type { BlockHistoryUiState } from '../definitions/blockHistory';
export function getDefaultUiState(): BlockHistoryUiState {
  return {
    mode: 'none',
    selectedVersionId: undefined,
    selectedVersionIds: undefined,
    focusedLineIndex: undefined,
    isLoading: false,
  };
}
