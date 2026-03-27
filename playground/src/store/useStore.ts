import { create } from 'zustand';

import type { SimulationResult } from '../../../src/interpreter/interpreter.js';
import type { Program } from '../../../src/parser/ast.js';

export interface KetStore {
  source: string;
  setSource: (src: string) => void;
  status: 'idle' | 'running' | 'success' | 'error';
  setStatus: (status: KetStore['status']) => void;
  result: SimulationResult | null;
  setResult: (result: SimulationResult | null) => void;
  qasmOutput: string | null;
  setQasmOutput: (qasm: string | null) => void;
  error: string | null;
  setError: (error: string | null) => void;
  activePanel: 'circuit' | 'results' | 'qasm';
  setActivePanel: (panel: KetStore['activePanel']) => void;
  ast: Program | null;
  setAst: (ast: Program | null) => void;
}

export const useStore = create<KetStore>((set) => ({
  source: '',
  setSource: (source) => set({ source }),
  status: 'idle',
  setStatus: (status) => set({ status }),
  result: null,
  setResult: (result) => set({ result }),
  qasmOutput: null,
  setQasmOutput: (qasmOutput) => set({ qasmOutput }),
  error: null,
  setError: (error) => set({ error }),
  activePanel: 'circuit',
  setActivePanel: (activePanel) => set({ activePanel }),
  ast: null,
  setAst: (ast) => set({ ast })
}));
