export interface AppInstanceOwnershipPort {
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: () => void): void;
  quit(): void;
}

export interface AppInstanceOwnership {
  readonly status: 'primary' | 'secondary';
}

export interface DevelopmentAppProfilePort {
  readonly isPackaged: boolean;
  readonly commandLine: { hasSwitch(name: string): boolean };
  getPath(name: 'userData'): string;
  setPath(name: 'userData' | 'sessionData', value: string): void;
}
