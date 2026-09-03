import fs from 'node:fs';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';

const [markerPath, runToken, requiredApprovalMemoryPath = ''] = process.argv.slice(2);
if (!markerPath || !runToken) {
  process.stderr.write('missing marker path or run token\n');
  process.exit(2);
}
if (requiredApprovalMemoryPath && !fs.existsSync(requiredApprovalMemoryPath)) {
  process.stderr.write('conversation approval was not persisted before spawn\n');
  process.exit(3);
}

fs.writeFileSync(markerPath, JSON.stringify({
  version: 1,
  runToken,
  pid: process.pid,
}), { encoding: 'utf8', flag: 'wx' });

const heartbeatPath = `${markerPath}.heartbeat`;
let sequence = 0;
const heartbeat = setInterval(() => {
  sequence += 1;
  fs.appendFileSync(
    heartbeatPath,
    `${runToken}\t${process.pid}\t${sequence}\n`,
    'utf8',
  );
  if (sequence === 3) {
    clearInterval(heartbeat);
  }
}, 20);
