void import('./runValidationApp').then(
  module => module.runValidationApp(),
  error => {
    const stableError = error instanceof Error ? error.name : 'unknown';
    process.stderr.write(`formal_sandbox_fixture_load_failed:${stableError}\n`);
    process.exit(1);
  },
);
