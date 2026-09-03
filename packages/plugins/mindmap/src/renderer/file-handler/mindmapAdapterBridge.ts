import type { MindMapMetadata } from '../ipc/mindMapGateway';
import type { MindMapData } from '../domain/types';

export interface MindMapAdapterSession {
  documentId: string;
  name?: string | null;
  content: MindMapData;
  metadata?: MindMapMetadata | null;
}

export interface MindMapSerializableState {
  content: MindMapData;
  metadata: MindMapMetadata;
}

export interface MindMapAdapter {
  setDocumentSession(payload: MindMapAdapterSession): void;
  getSerializableState(): MindMapSerializableState | null;
  closeDocumentSession(documentId: string): void;
}

let adapter: MindMapAdapter | null = null;

export function registerMindMapAdapter(instance: MindMapAdapter) {
  adapter = instance;
}

export function getMindMapAdapter(): MindMapAdapter {
  if (!adapter) {
    throw new Error('[file-manager] MindMap adapter 尚未注册');
  }
  return adapter;
}
