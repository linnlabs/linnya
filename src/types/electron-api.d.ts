/**
 * @file src/types/electron-api.d.ts
 *
 * Electron API 全局类型定义
 * 为渲染进程中的 window.electronAPI 提供类型支持
 *
 * @remarks
 * 此文件与 apps/renderer/shared/types/fs.ts 中的类型定义保持一致
 */

// 引入共享类型定义
import type {
  DocumentData,
  ListDirectoryResult,
  OperationResult,
  SaveFileResult,
  CreateResult,
  RenameResult,
  MoveResult,
  RenamePayload,
  ItemDeletedPayload,
  ItemMovedPayload,
  FileContentLoadedPayload,
  InitialStatePayload,
} from '../../apps/renderer/shared/types/fs';
import type {
  PluginDiagnosticView,
  PluginStateView,
  PluginRemoteInstallResult,
  PluginRemoteUpdateCheckResult,
  PluginStoreDetail,
  PluginStoreListItem,
  UserFacingMessage,
  WorkspaceMutationEvent,
} from '@app/schemas';
import type { UpdateStatusMessage } from '../shared/update/definitions/updateMessage';
import type { CommandPermissionSettingsUpdateV1 } from '@app/schemas/commands';
import type {
  WindowClosePreparationResult,
  WindowCloseRequestId,
  WindowCloseRequestMessage,
} from '../shared/app-lifecycle/definitions/windowCloseProtocol';

interface SystemOperationFailureFields {
  error?: string;
  userMessage?: UserFacingMessage;
}

type MediaOperationFailureFields = SystemOperationFailureFields;

interface SelectImageDialogOptions {
  title?: string;
  imageFilterName?: string;
}

interface EmbedImageResult extends MediaOperationFailureFields {
  success: boolean;
  locator?: string;
  fileName?: string;
  fileSize?: number;
}

interface ExportFileDialogOptions {
  fileType: string;
  title?: string;
  buttonLabel?: string;
  filterName?: string;
}

interface ExportPdfDialogOptions {
  htmlContent: string;
  title?: string;
  buttonLabel?: string;
  filterName?: string;
}

interface ExportIpcResult extends MediaOperationFailureFields {
  success: boolean;
  cancelled?: boolean;
  filePath?: string;
}

declare global {
  interface Window {
    linnyaMedia: {
      buildImageUrl: (filePath: string) => string;
      buildGeneratedImageUrl: (imagePath: string) => string;
      buildAudioUrl: (filePath: string) => string;
      getFileName: (filePath: string) => string;
    };

    electronAPI: {
      'document-history:list': (request: { documentId: string }) => Promise<unknown>;
      'document-history:restore': (request: import('@app/schemas').DocumentVersionRestoreRequest) => Promise<unknown>;
      readCommandPermissionSettings: () => Promise<unknown>;
      updateCommandPermissionSettings: (
        update: CommandPermissionSettingsUpdateV1,
      ) => Promise<unknown>;
      openCommandApprovalPage: () => Promise<unknown>;
      replyToCommandApproval: (submission: unknown) => Promise<unknown>;
      onCommandApprovalChanged: (callback: (event: unknown) => void) => () => void;
      openCommandCardControlPage: (request: unknown) => Promise<unknown>;
      closeCommandCardControlPage: (request: unknown) => Promise<unknown>;
      cancelCommandFromCard: (submission: unknown) => Promise<unknown>;
      submitCommandProtectedInput: (submission: unknown) => Promise<unknown>;
      onCommandCardControlChanged: (callback: (event: unknown) => void) => () => void;
      /**
       * 通用 IPC invoke（带 preload 白名单 gate）
       *
       * 中文说明：
       * - 阶段0新增 Telemetry/DeepResearch 等能力会优先走 invoke，以避免给 window 注入过多专用方法；
       * - 返回值类型由具体 channel 决定，这里统一用 unknown 表达，调用方需自行做结构化校验（禁止 any）。
       */
      invoke: (channel: string, data?: unknown) => Promise<unknown> | undefined;
      on: (channel: string, callback: (payload: unknown) => void) => (() => void) | undefined;
      'plugin:invoke': (pluginId: string, channel: string, payload: unknown) => Promise<unknown>;
      'plugin:onPush': (
        pluginId: string,
        channel: string,
        callback: (payload: unknown) => void,
      ) => (() => void) | undefined;

      // File system & state sync
      notifyMainReadyForState: () => void;
      onInitialStateReady: (callback: (state: InitialStatePayload) => void) => () => void;
      getInitialState: () => Promise<any>;

      // File operations
      onFileContentLoaded: (callback: (data: FileContentLoadedPayload) => void) => () => void;
      onPathUpdated: (callback: (payload: RenamePayload) => void) => () => void;
      onError: (callback: (errorMessage: string) => void) => () => void;
      openFile: () => void;
      saveFile: (filePath: string, data: DocumentData) => Promise<SaveFileResult>;
      requestSaveFileAs: (data: DocumentData) => void;
      onSaveSuccess: (callback: (filePath: string) => void) => () => void;

      // Directory operations
      listDirectory: (dirPath: string | null) => Promise<ListDirectoryResult>;
      openFileByPath: (filePath: string) => Promise<OperationResult>;
      createDirectory: (dirPath: string) => Promise<CreateResult>;
      createEmptyFile: (filePath: string, initialContent: DocumentData) => Promise<CreateResult>;
      deleteItem: (itemPath: string) => Promise<OperationResult>;
      renameItem: (oldPath: string, newName: string) => Promise<RenameResult>;
      moveItem: (sourcePath: string, targetFolderPath: string) => Promise<MoveResult>;
      onTriggerRename: (callback: (itemPath: string) => void) => () => void;
      onTriggerDelete: (callback: (itemPath: string) => void) => () => void;
      onItemDeleted: (callback: (payload: ItemDeletedPayload) => void) => () => void;
      onItemMoved: (callback: (payload: ItemMovedPayload) => void) => () => void;
      
      // Window operations
      windowAction: (action: 'minimize' | 'maximize' | 'close') => void;
      onWindowMaximizedState: (callback: (isMaximized: boolean) => void) => () => void;
      onWindowFocusState: (callback: (focused: boolean) => void) => () => void;
      onWindowCloseRequest: (callback: (request: WindowCloseRequestMessage) => void) => () => void;
      markWindowCloseRendererReady: () => void;
      completeWindowClosePreparation: (
        requestId: WindowCloseRequestId,
        result: WindowClosePreparationResult,
      ) => void;
      
      // Image operations
      selectImage: () => Promise<{ success: boolean; filePath?: string } & MediaOperationFailureFields>;
      myAppSelectImageDialog: (options?: SelectImageDialogOptions) => Promise<{
        canceled: boolean;
        filePaths?: string[];
      } & MediaOperationFailureFields>;
      embedImageBytes: (request: {
        documentNodeId: string;
        bytes: ArrayBuffer;
        ext: string;
        fileName?: string;
      }) => Promise<EmbedImageResult>;
      pickAndEmbedImage: (request: {
        documentNodeId: string;
        title?: string;
        imageFilterName?: string;
      }) => Promise<{
        canceled: boolean;
      } & EmbedImageResult>;
      loadImageAsDataURL: (filePath: string) => Promise<{
        success: boolean;
        dataUrl?: string;
        fileName?: string;
        fileSize?: number;
      } & MediaOperationFailureFields>;
      statImageFile: (filePath: string) => Promise<{
        success: boolean;
        size?: number;
        mtimeMs?: number;
      } & MediaOperationFailureFields>;
      // Audio operations
      saveAudioFile: (audioDataBuffer: ArrayBuffer, mimeType: string) => Promise<{ 
        success: boolean; 
        filePath?: string; 
      } & MediaOperationFailureFields>;
      loadAudioFileAsDataURL: (filePath: string) => Promise<{ 
        success: boolean; 
        dataUrl?: string; 
      } & MediaOperationFailureFields>;
      
      // File info and operations
      getFileSize: (filePath: string) => Promise<{ 
        success: boolean; 
        size?: number; 
      } & MediaOperationFailureFields>;
      showItemInFolder: (filePath: string) => Promise<{ 
        success: boolean; 
      } & SystemOperationFailureFields>;
      resolveConversationFileLink: (
        request: import('@app/schemas').ConversationFileLinkResolveRequest,
      ) => Promise<import('@app/schemas').OperationResult<
        import('@app/schemas').ConversationFileLinkResolution
      >>;
      revealConversationFileLink: (
        request: import('@app/schemas').ConversationFileLinkRevealRequest,
      ) => Promise<import('@app/schemas').OperationResult<void>>;
      getElectronProcessMemory: () => Promise<import('@app/schemas').ElectronProcessMemoryResponse>;

      /**
       * 使用系统默认浏览器打开外部链接
       *
       * 中文说明：
       * - 主进程会限制协议（仅允许 http/https），避免打开危险协议。
       */
      openExternalUrl: (url: string) => Promise<{ success: boolean } & SystemOperationFailureFields>;
      
      // File export
      exportFile: (
        defaultFileName: string,
        content: unknown,
        options: string | ExportFileDialogOptions,
      ) => Promise<ExportIpcResult>;
      exportPDF: (
        defaultFileName: string,
        payload: string | ExportPdfDialogOptions,
      ) => Promise<ExportIpcResult>;
      requestExportArtifactTarget: (
        request: import('@linnya/plugin-host-contract/renderer/exportArtifact').ExportArtifactTargetRequest,
      ) => Promise<
        import('@linnya/plugin-host-contract/renderer/exportArtifact').ExportArtifactTargetResult
      >;
      /**
       * 打开“选择文件”对话框
       * 中文说明：返回结构对齐 Electron 的 showOpenDialog 返回值
       */
      openFileDialog: (options: unknown) => Promise<{
        success: boolean;
        data?: { canceled: boolean; filePaths: string[] };
      } & MediaOperationFailureFields>;
      /**
       * 打开“选择目录”对话框
       * 中文说明：返回结构对齐 Electron 的 showOpenDialog 返回值
       */
      openDirectoryDialog: (options: unknown) => Promise<{
        success: boolean;
        data?: { canceled: boolean; filePaths: string[] };
      } & MediaOperationFailureFields>;
      /**
       * 批量导出到目录：主进程负责文件写入与重名处理
       */
      exportFilesToDirectory: (payload: { directoryPath: string; files: Array<{ fileName: string; content: string }> }) => Promise<{
        success: boolean;
        data?: { writtenPaths: string[] };
      } & MediaOperationFailureFields>;
      onWorkspaceMutation: (callback: (event: WorkspaceMutationEvent) => void) => () => void;
      
      // Knowledge base operations
      getAllKbs: () => Promise<any>;
      createKb: (name: string, description?: string) => Promise<any>;
      deleteKb: (kbId: string) => Promise<any>;
      getDefaultKb: () => Promise<any>;
      getDocumentsInKb: (kbId: string) => Promise<any>;
      addDocumentToKb: (kbId: string, filePath: string) => Promise<any>;
      deleteDocumentInKb: (kbId: string, docId: string) => Promise<any>;
      searchKb: (kbId: string, query: string, topK?: number) => Promise<any>;
      readSotDocument: (kbId: string, docId: string) => Promise<any>;
      getTasksStatus: () => Promise<any>;
      onTaskStatusUpdate: (callback: (status: any) => void) => () => void;
      
      // Model registry
      getModels: () => Promise<any>;
      updateModels: (models: any) => Promise<any>;
      
      // Update events
      onUpdateMessage: (callback: (message: UpdateStatusMessage) => void) => () => void;

      // Plugin state
      plugins: {
        list: () => Promise<{ success: true; data: PluginStateView[] } | { success: false; error?: string }>;
        storeList: () => Promise<{ success: true; data: PluginStoreListItem[] } | { success: false; error?: string }>;
        getDetail: (pluginId: string) => Promise<{ success: true; data: PluginStoreDetail } | { success: false; error?: string }>;
        diagnostics: () => Promise<{ success: true; data: readonly PluginDiagnosticView[] } | { success: false; error?: string }>;
        rendererEntries: () => Promise<unknown>;
        checkRemoteUpdate: (pluginId: string) => Promise<{ success: true; data: PluginRemoteUpdateCheckResult } | { success: false; error?: string }>;
        installFromRemote: (pluginId: string) => Promise<{ success: true; data: PluginRemoteInstallResult } | { success: false; error?: string }>;
        uninstall: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
        setEnabled: (pluginId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
        onChanged: (callback: () => void) => () => void;
      };
    };
  }
}

export {};
