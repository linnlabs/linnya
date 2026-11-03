import path from 'node:path';
import { startCanvasEvaluationBridge } from './startCanvasEvaluationBridge';

const [projectId, origin, html, descriptor] = process.argv.slice(2);
if (!projectId || !origin || !html || !descriptor) throw new Error('Usage: runBridge.ts <project-id> <vite-origin> <index.html> <new-connection.json>');
const bridge = await startCanvasEvaluationBridge({ projectId, origin, indexHtmlPath: path.resolve(html), descriptorPath: path.resolve(descriptor) });
process.stdout.write(JSON.stringify({ ready: true, port: bridge.connection.port, projectId, descriptor: path.resolve(descriptor) }) + '\n');
const finish = () => { void bridge.close().then(() => process.exit(0), error => { process.stderr.write(String(error) + '\n'); process.exit(1); }); };
process.once('SIGINT', finish); process.once('SIGTERM', finish);
