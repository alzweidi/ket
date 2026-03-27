import { QasmEmitter } from '../../codegen/qasm.js';
import { compileSource } from '../../shared/compiler.js';
import { readSourceFile } from '../../shared/files.js';

export function compileCommand(args: string[]): void {
  const file = args[0];
  if (!file) {
    throw new Error('Usage: ket compile <file.ket>');
  }
  const source = readSourceFile(file);
  const program = compileSource(source, file);
  process.stdout.write(new QasmEmitter().emit(program));
}
