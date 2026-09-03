import type { OperationResult } from './workspaceRuntime';

export interface PluginDocumentCreateRequest {
  projectId: string;
  parentId: string | null;
  name: string;
  createRequestType: string;
}

export interface PluginDocumentCreationHandler {
  id: string;
  createDocument(request: PluginDocumentCreateRequest): Promise<OperationResult<{ documentId: string }>>;
}

export declare function registerPluginDocumentCreationHandler(handler: PluginDocumentCreationHandler): void;
export declare function unregisterPluginDocumentCreationHandler(id: string): void;
