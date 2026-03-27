import { useCallback, useEffect, useRef } from 'react';

import type { SimulationResult } from '../../../src/interpreter/interpreter.js';
import type { Program } from '../../../src/parser/ast.js';

export type WorkerInMessage =
  | { action: 'run'; source: string }
  | { action: 'compile'; source: string }
  | { action: 'parse'; source: string };

export type WorkerOutMessage =
  | { action: 'run_result'; result: SimulationResult }
  | { action: 'compile_result'; qasm: string }
  | { action: 'parse_result'; ast: Program }
  | { action: 'error'; message: string; originalAction: string };

export function useKetWorker(onMessage: (message: WorkerOutMessage) => void) {
  const handlerRef = useRef(onMessage);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/ket.worker.ts', import.meta.url), {
      type: 'module'
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      handlerRef.current(event.data);
    };
    return () => {
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
  }, []);

  const request = useCallback((message: WorkerInMessage) => {
    workerRef.current?.postMessage(message);
  }, []);

  return {
    request
  };
}
