import { describe, expect, it } from 'vitest';

import { QasmEmitter } from '../src/codegen/qasm.js';
import { compileSource } from '../src/shared/compiler.js';

describe('QasmEmitter', () => {
  it('emits Bell state QASM', () => {
    const program = compileSource(
      'circuit bell() {\nqubit q[2]\nH q[0]\nCNOT q[0], q[1]\nlet r = measure q\n}\nrun bell()\n',
      'bell.ket'
    );
    const qasm = new QasmEmitter().emit(program);
    expect(qasm).toContain('OPENQASM 2.0;');
    expect(qasm).toContain('qreg q[2];');
    expect(qasm).toContain('h q[0];');
    expect(qasm).toContain('cx q[0], q[1];');
    expect(qasm).toContain('measure q[0] -> r[1];');
    expect(qasm).toContain('measure q[1] -> r[0];');
  });

  it('substitutes run-time bitstring parameters into phase oracles', () => {
    const program = compileSource(
      'circuit grover(target: bitstring) {\nqubit q[3]\nphase_oracle q matches target\nlet r = measure q\n}\nrun grover(|101⟩)\n',
      'grover.ket'
    );
    const qasm = new QasmEmitter().emit(program);
    expect(qasm).toContain('x q[1];');
    expect(qasm).not.toContain('x q[0];');
    expect(qasm).not.toContain('x q[2];');
  });

  it('emits indexed measurements into a classical bit slot', () => {
    const program = compileSource(
      'circuit measure_one() {\nqubit q[2]\nlet c = measure q[0]\n}\nrun measure_one()\n',
      'measure-one.ket'
    );
    const qasm = new QasmEmitter().emit(program);
    expect(qasm).toContain('creg c[1];');
    expect(qasm).toContain('measure q[0] -> c[0];');
  });

  it('emits resolved angle circuit parameters as numeric QASM arguments', () => {
    const program = compileSource(
      'circuit rotate(theta: angle) {\nqubit q\nRx(theta) q\nlet r = measure q\n}\nrun rotate(π)\n',
      'rotate.ket'
    );
    const qasm = new QasmEmitter().emit(program);
    const angle = qasm.match(/rx\(([^)]+)\) q\[0\];/)![1]!;
    expect(Number(angle)).toBe(Math.PI);
  });

  it('preserves small angles and rejects a non-finite rotation', () => {
    const emitRotation = (angle: string) => new QasmEmitter().emit(
      compileSource(`qubit q\nRz(${angle}) q\n`, 'rotation.ket')
    );
    const literal = emitRotation('1/1000000000000').match(/rz\(([^)]+)\)/)![1]!;
    expect(literal).toMatch(/^\d+\.\d+e-\d+$/);
    expect(Number(literal)).toBe(1e-12);
    expect(() => emitRotation('sqrt(0-1)')).toThrow('non-finite rotation');
  });
});
