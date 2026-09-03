import { readByokLiveSmokeConfiguration } from './functions/readByokLiveSmokeConfiguration';
import { runByokLiveSmoke } from './orchestration/runByokLiveSmoke';

try {
  const configuration = readByokLiveSmokeConfiguration(process.env);
  await runByokLiveSmoke(configuration, message => console.log(message));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'BYOK live smoke 出现未知错误。';
  console.error(message);
  process.exitCode = 1;
}
