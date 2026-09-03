export interface AppInstanceOwnershipPort {
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: () => void): void;
  quit(): void;
}

export interface AppInstanceOwnership {
  readonly status: 'primary' | 'secondary';
}
