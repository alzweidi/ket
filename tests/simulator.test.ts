import { describe, expect, it, vi } from 'vitest';

import { gateCNOT, gateH, gateX } from '../src/simulator/gates.js';
import { measureAll, measureRegister } from '../src/simulator/measurement.js';
import { StateVector } from '../src/simulator/statevector.js';
import { compileSource } from '../src/shared/compiler.js';
import { Interpreter } from '../src/interpreter/interpreter.js';

describe('StateVector', () => {
  it('applies H to |0> producing equal probabilities', () => {
    const state = new StateVector(1);
    state.applySingle(gateH(), 0);
    const probabilities = state.probabilities();
    expect(probabilities[0]).toBeCloseTo(0.5, 10);
    expect(probabilities[1]).toBeCloseTo(0.5, 10);
  });

  it('applies X to |0> producing |1>', () => {
    const state = new StateVector(1);
    state.applySingle(gateX(), 0);
    expect(state.probabilities()).toEqual([0, 1]);
  });

  it('builds a Bell state', () => {
    const state = new StateVector(2);
    state.applySingle(gateH(), 0);
    state.applyTwo(gateCNOT(), 0, 1);
    const probabilities = state.probabilities();
    expect(probabilities[0]).toBeCloseTo(0.5, 10);
    expect(probabilities[3]).toBeCloseTo(0.5, 10);
  });

  it('measures all qubits using the Born rule', () => {
    const state = new StateVector(1);
    state.applySingle(gateH(), 0);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.9);
    expect(measureAll(state).bitstring).toBe('1');
  });

  it('covers defensive measurement fallbacks', () => {
    const state = new StateVector(1);

    expect(() => measureRegister(state, [])).toThrow('Failed to sample register measurement');

    vi.spyOn(Math, 'random').mockReturnValueOnce(Number.NaN);
    expect(measureAll(state).bitstring).toBe('1');
  });
});

describe('Interpreter', () => {
  it('amplifies the Grover target state', () => {
    const program = compileSource(
      `circuit grover(target: bitstring) {\nqubit q[3]\nH q[0]\nH q[1]\nH q[2]\nrepeat 2 {\nphase_oracle q matches target\ndiffuse q\n}\nlet r = measure q\n}\nrun grover(|101⟩)\n`,
      'grover.ket'
    );
    const result = new Interpreter(program, { shots: 256 }).run();
    expect((result.probabilities.get('101') ?? 0)).toBeGreaterThan(0.7);
  });
});
