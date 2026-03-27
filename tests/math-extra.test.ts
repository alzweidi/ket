import { describe, expect, it } from 'vitest';

import {
  C,
  I,
  ONE,
  ZERO,
  cabs,
  cadd,
  cconj,
  cdiv,
  ceq,
  cexp,
  cmul,
  cneg,
  creal,
  csub,
} from '../src/simulator/complex.js';
import {
  gateCNOT,
  gateCZ,
  gateH,
  gateRx,
  gateRy,
  gateRz,
  gateSWAP,
  gateS,
  gateT,
  gateToffoli,
  gateX,
  gateY,
  gateZ,
} from '../src/simulator/gates.js';
import { StateVector } from '../src/simulator/statevector.js';
import { KetType, SymbolTable } from '../src/typechecker/types.js';

describe('complex helpers', () => {
  it('supports arithmetic and equality', () => {
    expect(cadd(C(1, 2), C(3, 4))).toEqual(C(4, 6));
    expect(csub(C(5, 7), C(2, 3))).toEqual(C(3, 4));
    expect(cmul(C(1, 2), C(3, 4))).toEqual(C(-5, 10));
    expect(cdiv(C(1, 2), C(3, -4))).toEqual(C(-0.2, 0.4));
    expect(cconj(C(2, 3))).toEqual(C(2, -3));
    expect(cneg(C(2, -3))).toEqual(C(-2, 3));
    expect(cabs(C(3, 4))).toBe(5);
    expect(cexp(Math.PI / 2).re).toBeCloseTo(0, 10);
    expect(cexp(Math.PI / 2).im).toBeCloseTo(1, 10);
    expect(creal(7)).toEqual(C(7, 0));
    expect(ceq(C(1, 1), C(1 + 1e-11, 1 - 1e-11))).toBe(true);
    expect(I).toEqual(C(0, 1));
    expect(ONE).toEqual(C(1, 0));
    expect(ZERO).toEqual(C(0, 0));
  });
});

describe('gate matrices', () => {
  it('builds all supported matrices', () => {
    expect(gateH()[0][0].re).toBeCloseTo(1 / Math.SQRT2, 10);
    expect(gateX()).toEqual([
      [ZERO, ONE],
      [ONE, ZERO],
    ]);
    expect(gateY()[0][1]).toEqual(C(0, -1));
    expect(gateZ()[1][1]).toEqual(C(-1, 0));
    expect(gateS()[1][1]).toEqual(I);
    expect(gateT()[1][1].re).toBeCloseTo(Math.cos(Math.PI / 4), 10);
    expect(gateRx(Math.PI)[0][0].re).toBeCloseTo(0, 10);
    expect(gateRy(Math.PI)[1][0].re).toBeCloseTo(1, 10);
    expect(gateRz(Math.PI)[0][0].im).toBeCloseTo(-1, 10);
    expect(gateCNOT()[2][3]).toEqual(ONE);
    expect(gateCZ()[3][3]).toEqual(C(-1, 0));
    expect(gateSWAP()[1][2]).toEqual(ONE);
    const toffoli = gateToffoli();
    expect(toffoli[6][7]).toEqual(ONE);
    expect(toffoli[7][6]).toEqual(ONE);
  });
});

describe('statevector operations', () => {
  it('rejects invalid qubit counts', () => {
    expect(() => new StateVector(0)).toThrow('n must be 1-20');
    expect(() => new StateVector(21)).toThrow('n must be 1-20');
  });

  it('clones and replaces amplitudes safely', () => {
    const state = new StateVector(1);
    state.applySingle(gateX(), 0);
    const clone = state.clone();
    expect(clone.getAmplitudes()).toEqual(state.getAmplitudes());
    expect(clone.getN()).toBe(1);

    const next = StateVector.fromAmplitudes(1, [C(0, 0), C(1, 0)]);
    state.replaceWith(next);
    expect(state.probabilities()).toEqual([0, 1]);
    expect(() => state.replaceWith(new StateVector(2))).toThrow(
      'different qubit count'
    );
  });

  it('applies controlled, two-qubit, three-qubit, and multi-controlled operations', () => {
    const controlled = new StateVector(2);
    controlled.applySingle(gateX(), 0);
    controlled.applyControlledSingle(gateX(), 0, 1);
    expect(controlled.probabilities()).toEqual([0, 0, 0, 1]);

    const swapped = new StateVector(2);
    swapped.applySingle(gateX(), 1);
    swapped.applyTwo(gateSWAP(), 0, 1);
    expect(swapped.probabilities()).toEqual([0, 0, 1, 0]);

    const toffoli = new StateVector(3);
    toffoli.applySingle(gateX(), 0);
    toffoli.applySingle(gateX(), 1);
    toffoli.applyThree(gateToffoli(), 0, 1, 2);
    expect(toffoli.probabilities()[7]).toBe(1);

    const mcx = new StateVector(3);
    mcx.applySingle(gateX(), 0);
    mcx.applySingle(gateX(), 1);
    mcx.applyMultiControlledX([0, 1], 2);
    expect(mcx.probabilities()[7]).toBe(1);
  });

  it('rejects invalid qubit operands and zero-normalisation', () => {
    const state = new StateVector(2);
    expect(() => state.applySingle(gateH(), 2)).toThrow('out of bounds');
    expect(() => state.applyControlledSingle(gateX(), 0, 0)).toThrow(
      'must be distinct'
    );
    expect(() => state.applyTwo(gateCZ(), 0, 0)).toThrow('must be distinct');
    expect(() => state.applyMultiControlledX([0, 0], 1)).toThrow(
      'must be distinct'
    );

    const zero = StateVector.fromAmplitudes(1, [ZERO, ZERO]);
    expect(() => zero.normalize()).toThrow('Cannot normalize zero state');
  });
});

describe('symbol table', () => {
  it('manages scopes, lookups, and measurements', () => {
    const table = new SymbolTable();
    table.declare('q', {
      type: KetType.QReg,
      size: 2,
      measured: false,
      measuredIndices: new Set(),
      declaredAt: { line: 1, column: 1 },
    });

    expect(table.lookup('q')?.type).toBe(KetType.QReg);
    expect(table.lookup('missing')).toBeNull();

    table.pushScope();
    table.declare('inner', {
      type: KetType.Bit,
      size: 1,
      measured: false,
      measuredIndices: new Set(),
      declaredAt: { line: 2, column: 1 },
    });
    expect(() =>
      table.declare('inner', {
        type: KetType.Bit,
        size: 1,
        measured: false,
        measuredIndices: new Set(),
        declaredAt: { line: 2, column: 1 },
      })
    ).toThrow('already declared');

    table.markMeasured('q');
    expect(table.lookup('q')?.measured).toBe(true);

    table.markMeasured('inner', 0);
    expect(table.lookup('inner')?.measuredIndices.has(0)).toBe(true);

    table.popScope();
    expect(() => table.popScope()).toThrow('Cannot pop global scope');
    expect(() => table.markMeasured('missing')).toThrow(
      'Cannot mark missing symbol'
    );
  });
});
