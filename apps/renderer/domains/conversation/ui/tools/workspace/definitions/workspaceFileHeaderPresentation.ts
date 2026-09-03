import type { WorkspaceDocumentReadData } from '@app/schemas';

export type WorkspaceListFilesPresentationData =
  | {
      readonly kind: 'lifecycle';
    }
  | {
      readonly kind: 'snapshot';
      readonly locator: string;
      readonly totalCount: number;
      readonly hasMore: boolean;
    };

export type WorkspaceGrepPresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly pattern: string;
    }
  | {
      readonly kind: 'snapshot';
      readonly pattern: string;
      readonly totalCount: number;
      readonly truncated: boolean;
    };

export type WorkspaceReadFilePresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly target: string;
    }
  | {
      readonly kind: 'snapshot';
      readonly locator: string;
      readonly contentType: string;
      readonly hasMore: boolean;
      readonly document?: WorkspaceDocumentReadData;
    };

export type WorkspaceWriteFilePresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly target?: string;
    }
  | {
      readonly kind: 'snapshot';
      readonly locator: string;
      readonly operation: 'create' | 'update';
      readonly diagnosticCount: number;
    };

export type WorkspaceEditFilePresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly target?: string;
    }
  | {
      readonly kind: 'snapshot';
      readonly locator: string;
      readonly replaced: number;
      readonly diagnosticCount: number;
    };
