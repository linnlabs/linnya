import { ref } from 'vue';
import type { WorkspaceAssetImagePreviewState } from '@/domains/workspace/features/asset-image-preview';

export interface SidebarTextPreviewState {
  visible: boolean;
  loading: boolean;
  name: string;
  text: string;
  error: string;
}

function createEmptyImagePreview(): WorkspaceAssetImagePreviewState {
  return {
    visible: false,
    loading: false,
    src: '',
    name: '',
    error: '',
  };
}

function createEmptyTextPreview(): SidebarTextPreviewState {
  return {
    visible: false,
    loading: false,
    name: '',
    text: '',
    error: '',
  };
}

export function useSidebarAssetPreviewState() {
  const imagePreview = ref(createEmptyImagePreview());
  const textPreview = ref(createEmptyTextPreview());

  function closeTextPreview(): void {
    textPreview.value = createEmptyTextPreview();
  }

  return {
    imagePreview,
    textPreview,
    closeTextPreview,
  };
}
