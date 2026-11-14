import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { QasmEmitter } from '../src/codegen/qasm.js';
import { Interpreter } from '../src/interpreter/interpreter.js';
import { compileSource } from '../src/shared/compiler.js';

describe('Integration', () => {
  it('runs the Bell state example', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'examples', 'bell-state.ket'), 'utf8');
    const program = compileSource(source, 'examples/bell-state.ket');
    const result = new Interpreter(program, { shots: 256 }).run();
    expect((result.probabilities.get('00') ?? 0) + (result.probabilities.get('11') ?? 0)).toBeGreaterThan(0.9);
  });

  it('compiles the Bell state example to QASM', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'examples', 'bell-state.ket'), 'utf8');
    const program = compileSource(source, 'examples/bell-state.ket');
    const qasm = new QasmEmitter().emit(program);
    expect(qasm.startsWith('OPENQASM 2.0;')).toBe(true);
  });

  it('teleports a plus state and verifies it in the x basis', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'examples', 'teleportation.ket'), 'utf8');
    const program = compileSource(source, 'examples/teleportation.ket');
    const result = new Interpreter(program, { shots: 64 }).run();
    expect([...result.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(64);
    expect([...result.counts.keys()].every((bits) => bits.endsWith('0'))).toBe(true);
  });

  it('emits the concrete Grover oracle target in compiled QASM', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'examples', 'grover.ket'), 'utf8');
    const program = compileSource(source, 'examples/grover.ket');
    const qasm = new QasmEmitter().emit(program);
    expect(qasm).toContain('x q[1];');
  });

  it('recovers a basis state after four Fourier transforms', () => {
    const source = 'qubit q[2]\nX q[1]\nrepeat 4 {\nqft q\n}\nlet r = measure q\n';
    const result = new Interpreter(compileSource(source, 'fourier.ket'), { shots: 64 }).run();
    expect(result.counts).toEqual(new Map([['01', 64]]));
  });

  it('runs circuits with angle parameters end to end', () => {
    const source = 'circuit rotate(theta: angle) {\nqubit q\nRx(theta) q\nlet r = measure q\n}\nrun rotate(π)\n';
    const program = compileSource(source, 'rotate.ket');
    const result = new Interpreter(program, { shots: 32 }).run();
    expect(result.counts.get('1') ?? 0).toBe(32);
  });
});
