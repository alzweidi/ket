import { Interpreter, type SimulationResult } from '../interpreter/interpreter.js';
import type { Program } from '../parser/ast.js';

export function runLocally(program: Program, shots = 1024): SimulationResult {
  const interpreter = new Interpreter(program, { shots });
  return interpreter.run();
}
