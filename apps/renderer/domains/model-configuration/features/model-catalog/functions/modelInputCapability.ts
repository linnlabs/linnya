import type { ModelCatalogItem } from '../definitions/modelCatalog';

const CHAT_CAPABILITY = 'chat';
const IMAGE_INPUT_CAPABILITY = 'image_input';

export function modelAcceptsUserImageInput(
  model: Pick<ModelCatalogItem, 'capabilities' | 'inference_route'> | undefined
): boolean {
  return (
    model?.capabilities?.includes(IMAGE_INPUT_CAPABILITY) === true &&
    model.inference_route?.input_support.user_image === true
  );
}

export function setImageInputCapability(
  capabilities: readonly string[] | undefined,
  enabled: boolean,
): string[] {
  const normalized = [...new Set((capabilities ?? [])
    .map(capability => capability.trim())
    .filter(capability => capability.length > 0 && capability !== IMAGE_INPUT_CAPABILITY))];

  return enabled
    ? [...normalized, IMAGE_INPUT_CAPABILITY]
    : normalized;
}

export function buildChatModelCapabilities(imageInputEnabled: boolean): string[] {
  return setImageInputCapability([CHAT_CAPABILITY], imageInputEnabled);
}
