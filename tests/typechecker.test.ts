import { describe, expect, it } from 'vitest';

import { compileSource } from '../src/shared/compiler.js';

describe('TypeChecker', () => {
  it('accepts valid gate applications', () => {
    expect(() => compileSource('qubit q[2]\nH q[0]\nCNOT q[0], q[1]\n', 'test.ket')).not.toThrow();
  });

  it('rejects operations on measured qubits', () => {
    expect(() => compileSource('qubit q\nlet r = measure q\nH q\n', 'test.ket')).toThrow('TypeError');
  });

  it('rejects same-qubit CNOT', () => {
    expect(() => compileSource('qubit q[2]\nCNOT q[0], q[0]\n', 'test.ket')).toThrow('TypeError');
  });

  it('allows sequential measurements of distinct qubits in the same register', () => {
    expect(() =>
      compileSource(
        'qubit q[3]\nlet a = measure q[0]\nlet b = measure q[1]\nlet c = measure q[2]\n',
        'test.ket'
      )
    ).not.toThrow();
  });

  it('rejects run-time bitstring arguments whose length does not match circuit usage', () => {
    expect(() =>
      compileSource(
        'circuit grover(target: bitstring) {\nqubit q[3]\nphase_oracle q matches target\nlet r = measure q\n}\nrun grover(|10⟩)\n',
        'test.ket'
      )
    ).toThrow("expects a bitstring of length 3");
  });

  it('accepts angle circuit parameters in gate expressions', () => {
    expect(() =>
      compileSource(
        'circuit rotate(theta: angle) {\nqubit q\nRx(theta) q\nlet r = measure q\n}\nrun rotate(π)\n',
        'test.ket'
      )
    ).not.toThrow();
  });

  it('rejects declarations nested inside control flow blocks', () => {
    expect(() =>
      compileSource('repeat 2 {\nqubit anc\nH anc\nlet r = measure anc\n}\n', 'test.ket')
    ).toThrow('inside if/repeat blocks are not supported');
  });

  it('rejects shadowing an outer binding', () => {
    expect(() =>
      compileSource(
        'qubit q[2]\nlet c = measure q[0]\nif c == 1 {\nlet c = measure q[1]\n}\n',
        'test.ket'
      )
    ).toThrow("already declared");
  });

  it('accepts user-defined gates with matching arity', () => {
    expect(() =>
      compileSource('gate bell(a, b) {\nH a\nCNOT a, b\n}\nqubit q[2]\nbell q[0], q[1]\n', 'test.ket')
    ).not.toThrow();
  });
});
