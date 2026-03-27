/// <reference lib="webworker" />

import { QasmEmitter } from '../../../src/codegen/qasm.js';
import { Interpreter } from '../../../src/interpreter/interpreter.js';
import { compileSource, parseSource } from '../../../src/shared/compiler.js';
import type { WorkerInMessage, WorkerOutMessage } from '../hooks/useKetWorker.js';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const message = event.data;
  try {
    if (message.action === 'run') {
      const program = compileSource(message.source, 'playground.ket');
      const result = new Interpreter(program, { shots: 1024 }).run();
      self.postMessage({ action: 'run_result', result } satisfies WorkerOutMessage);
      return;
    }

    if (message.action === 'compile') {
      const program = compileSource(message.source, 'playground.ket');
      const qasm = new QasmEmitter().emit(program);
      self.postMessage({ action: 'compile_result', qasm } satisfies WorkerOutMessage);
      return;
    }

    const program = parseSource(message.source, 'playground.ket');
    compileSource(message.source, 'playground.ket');
    self.postMessage({ action: 'parse_result', ast: program } satisfies WorkerOutMessage);
  } catch (error) {
    self.postMessage({
      action: 'error',
      message: error instanceof Error ? error.message : 'Unknown worker error',
      originalAction: message.action
    } satisfies WorkerOutMessage);
  }
};
