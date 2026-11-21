export type BackendHealthMessageKey =
  | 'backendHealth.restarting'
  | 'backendHealth.recovered'
  | 'backendHealth.stopped'
  | 'backendHealth.unresponsive'
  | 'backendHealth.actions.restart'
  | 'backendHealth.actions.restartBackend'
  | 'backendHealth.actions.openLogFolder'
  | 'backendHealth.restartConfirm.title'
  | 'backendHealth.restartConfirm.message'
  | 'backendHealth.restartFailed';
