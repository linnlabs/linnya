import path from 'node:path';
import { compareConformance } from './compareReport';
const root = process.argv[2];
if (!root) throw new Error('Usage: runCompare.ts OUTPUT_DIRECTORY');
const report = await compareConformance(path.resolve(root));
console.log(`PowerPoint conformance: ${report.status}; ${path.resolve(root, 'report.html')}`);
process.exitCode = report.status === 'incomplete' ? 1 : report.status === 'difference' ? 2 : 0;
