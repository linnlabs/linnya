import type { RunDocumentChangesPort } from '../definitions/runDocumentChanges';

let registeredPort: RunDocumentChangesPort | null = null;

export function registerRunDocumentChangesPort(port: RunDocumentChangesPort): void {
  registeredPort = port;
}

/** 未装配（夹具、独立预览）时为 null，尾部不显示改动清单。 */
export function findRunDocumentChangesPort(): RunDocumentChangesPort | null {
  return registeredPort;
}
