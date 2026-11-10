// One helper of ferramentas/diario-nucleo.mjs: it lives the robot's days handed to it, one at a time, with the
// engine of `engineDir` (journalEntry: every history cut at the day). Many of them run side by side, one per core:
// the past since 2019 is some two thousand days.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

const { engineDir, histories, dates } = workerData;
const analise = await import(pathToFileURL(join(engineDir, 'analise.js')).href);
for (const date of dates) parentPort.postMessage({ entry: analise.journalEntry(histories, date) });
parentPort.postMessage({ done: true });
