import { runCli } from './orchestration/runCli';

void runCli(process.argv.slice(2)).then(exitCode => {
  process.exitCode = exitCode;
});
