import type { MessageParams } from '../definitions/localizedText';

const MESSAGE_PARAM_PATTERN = /\{([A-Za-z0-9_.-]+)\}/g;
const EMPTY_PARAMS: MessageParams = {};

export function interpolateMessage(template: string, params: MessageParams = EMPTY_PARAMS): string {
  return template.replace(MESSAGE_PARAM_PATTERN, (match: string, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
