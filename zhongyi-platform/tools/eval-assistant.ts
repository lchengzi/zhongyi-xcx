import { mkdirSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { evaluateAssistantContract } from '../server/assistant-eval.js';

if (process.argv.length !== 2) throw new Error('Offline evaluation accepts no model/key/input arguments.');
const directory = resolve('.local'); mkdirSync(directory, { recursive: true });
if (lstatSync(directory).isSymbolicLink() || realpathSync(directory).toLowerCase() !== directory.toLowerCase()) throw new Error('Unsafe evaluation directory');
const report = evaluateAssistantContract(); const filename = join(directory, 'assistant-contract-eval.latest.json');
try { if (lstatSync(filename).isSymbolicLink() || !lstatSync(filename).isFile()) throw new Error('Unsafe evaluation output'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
