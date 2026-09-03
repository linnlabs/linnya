import type { BrowserWindow } from 'electron';
import type {
  MainWindowCloseDecision,
  MainWindowCloseIntent,
} from './app-lifecycle/definitions/mainWindowCloseLifecycle';

export function configureMainWindowCloseLifecycle(options: {
  readonly hasExecutingCommands: () => boolean | Promise<boolean>;
  readonly requestExecutingCommandsDecision?: (
    intent: MainWindowCloseIntent,
  ) => Promise<MainWindowCloseDecision>;
  readonly requestShutdown?: () => Promise<unknown>;
  readonly isWindowClosePermitted?: () => boolean;
  readonly canAcceptWindowRequests?: () => boolean;
}): void;
export function createWindow(): BrowserWindow | null;
export function getMainWindow(): BrowserWindow | null;
export function permitMainWindowCloseForAppShutdown(): void;
export function prepareMainWindowForAppShutdown(
  intent?: MainWindowCloseIntent,
): Promise<'kept_open' | 'ready_to_quit'>;
export function revealMainWindow(): void;
