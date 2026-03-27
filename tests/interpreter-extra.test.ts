import { describe, expect, it } from 'vitest';

import { Interpreter, evaluateAngleExpr } from '../src/interpreter/interpreter.js';
import { StateVector } from '../src/simulator/statevector.js';

const loc = { line: 1, column: 1 };
const qref = (name: string, index: number | null = null) => ({
  name,
  index,
  loc
});

describe('Interpreter internals', () => {
  it('runs top-level programs and exposes the single-shot statevector path', () => {
    const interpreter = new Interpreter({
      kind: 'program',
      body: [
        { kind: 'qubit_decl', name: 'q', size: 1, loc },
        { kind: 'gate_app', gate: 'X', targets: [qref('q')], loc }
      ]
    } as any);

    const result = interpreter.run();
    expect(result.counts.get('1')).toBe(1);
    expect(result.statevector).toBeDefined();
  });

  it('treats zero shots as the single-run execution path', () => {
    const interpreter = new Interpreter(
      {
        kind: 'program',
        body: [{ kind: 'qubit_decl', name: 'q', size: 1, loc }]
      } as any,
      { shots: 0 }
    );

    const result = interpreter.run();

    expect(result.counts.size).toBe(1);
    expect(result.statevector).toBeDefined();
  });

  it('covers binding, allocation, lookup, and control-flow helper branches', () => {
    const interpreter = new Interpreter({ kind: 'program', body: [] } as any) as any;
    const scopes = [new Map<string, any>()];

    expect(interpreter.findRunStatement()).toBeNull();
    expect(() =>
      interpreter.executeSingleRun({
        kind: 'run',
        circuit: 'missing',
        args: [],
        backend: 'local',
        loc
      })
    ).toThrow("Unknown circuit 'missing'");

    expect(() =>
      interpreter.bindRunArgs(
        scopes,
        { params: [{ name: 'target', type: 'bitstring' }], loc },
        [{ kind: 'angle_expr', expr: { kind: 'pi' } }]
      )
    ).toThrow("Expected ket literal for parameter 'target'");
    expect(() =>
      interpreter.bindRunArgs(
        scopes,
        { params: [{ name: 'theta', type: 'angle' }], loc },
        [{ kind: 'ket', bitstring: '1' }]
      )
    ).toThrow("Expected numeric value for parameter 'theta'");
    expect(() =>
      interpreter.bindRunArgs(
        scopes,
        { params: [{ name: 'q', type: 'qubit' }], loc },
        [{ kind: 'ket', bitstring: '1' }]
      )
    ).toThrow("Unsupported circuit parameter type 'qubit'");

    expect(
      interpreter.scanQubits([
        { kind: 'if', body: [{ kind: 'qubit_decl', name: 'a', size: 2, loc }], loc },
        { kind: 'repeat', body: [{ kind: 'qubit_decl', name: 'b', size: 1, loc }], loc }
      ])
    ).toBe(3);
    expect(interpreter.scanQubits([])).toBe(1);

    interpreter.allocateDeclarations(scopes, [
      { kind: 'qubit_decl', name: 'q', size: 2, loc },
      { kind: 'bit_decl', name: 'c', size: 1, loc },
      { kind: 'bit_decl', name: 'flag', size: null, loc },
      { kind: 'repeat', body: [{ kind: 'bit_decl', name: 'nested', size: 1, loc }], loc }
    ]);
    expect(scopes[0]?.get('q')).toMatchObject({ kind: 'qubit', startIndex: 0, size: 2 });
    expect(scopes[0]?.get('c')).toMatchObject({ kind: 'bit', size: 1 });
    expect(scopes[0]?.get('flag')).toMatchObject({ kind: 'bit', size: 1 });

    scopes.push(new Map([['inner', { kind: 'bit', size: 1, measured: true, value: '1' }]]));
    expect(interpreter.lookupBinding(scopes, 'inner')).toMatchObject({ kind: 'bit' });
    expect(interpreter.lookupBinding(scopes, 'missing')).toBeNull();
    scopes.pop();

    expect(
      interpreter.evaluateIf(scopes, {
        kind: 'if',
        condition: { kind: 'eq_int', ident: 'missing', value: 1 }
      })
    ).toBe(false);
  });

  it('covers gate, builtin, measurement, and runtime error branches', () => {
    const interpreter = new Interpreter({
      kind: 'program',
      body: [
        {
          kind: 'gate_def',
          name: 'bell',
          params: ['a', 'b'],
          body: [{ kind: 'gate_app', gate: 'H', targets: [qref('a')], loc }],
          loc
        }
      ]
    } as any) as any;
    const scopes = [
      new Map<string, any>([
        ['q', { kind: 'qubit', startIndex: 0, size: 3, measuredIndices: new Set<number>() }],
        ['target', { kind: 'bitstring', value: '101' }],
        ['theta', { kind: 'angle', value: Math.PI / 2 }],
        ['m', { kind: 'bit', size: 1, measured: true, value: '1' }]
      ])
    ];
    const state = new StateVector(3);

    interpreter.executeGateApp(state, scopes, { gate: 'Y', targets: [qref('q', 0)], loc });
    interpreter.executeGateApp(state, scopes, { gate: 'Z', targets: [qref('q', 0)], loc });
    interpreter.executeGateApp(state, scopes, { gate: 'S', targets: [qref('q', 0)], loc });
    interpreter.executeGateApp(state, scopes, { gate: 'T', targets: [qref('q', 0)], loc });
    interpreter.executeGateApp(state, scopes, {
      gate: 'CZ',
      targets: [qref('q', 0), qref('q', 1)],
      loc
    });
    interpreter.executeGateApp(state, scopes, {
      gate: 'SWAP',
      targets: [qref('q', 0), qref('q', 1)],
      loc
    });
    interpreter.executeGateApp(state, scopes, {
      gate: 'Toffoli',
      targets: [qref('q', 0), qref('q', 1), qref('q', 2)],
      loc
    });

    interpreter.executeBuiltin(state, scopes, {
      kind: 'builtin_algo',
      algo: 'diffuse',
      target: qref('q'),
      loc
    });
    interpreter.executeBuiltin(state, scopes, {
      kind: 'builtin_algo',
      algo: 'qft',
      target: qref('q'),
      loc
    });

    interpreter.applyMultiControlledZ(state, [0]);
    interpreter.applyMultiControlledZ(state, [0, 1]);
    interpreter.applyMultiControlledZ(state, [0, 1, 2]);

    expect(() =>
      interpreter.executePhaseOracle(state, scopes, {
        kind: 'phase_oracle',
        target: qref('q'),
        matchTarget: { kind: 'ident', name: 'target' },
        loc
      })
    ).not.toThrow();
    expect(() =>
      interpreter.executePhaseOracle(state, scopes, {
        kind: 'phase_oracle',
        target: qref('q'),
        matchTarget: { kind: 'ket', bitstring: '10' },
        loc
      })
    ).toThrow('does not match register size 3');

    const registerState = new StateVector(3);
    const registerOrder: string[] = [];
    interpreter.executeMeasurement(registerState, scopes, 'whole', qref('q'), registerOrder);
    expect(registerOrder[0]).toHaveLength(3);

    const indexedScopes = [
      new Map<string, any>([
        ['q', { kind: 'qubit', startIndex: 0, size: 1, measuredIndices: new Set<number>() }]
      ])
    ];
    const indexedState = new StateVector(1);
    const indexedOrder: string[] = [];
    interpreter.executeMeasurement(indexedState, indexedScopes, 'bit', qref('q', 0), indexedOrder);
    expect(indexedOrder[0]).toMatch(/[01]/);
    expect(() =>
      interpreter.executeMeasurement(indexedState, [new Map()], 'bad', qref('missing', 0), [])
    ).toThrow("Unknown quantum binding 'missing'");

    expect(() =>
      interpreter.executeUserGateCall(indexedState, indexedScopes, 'missing', [qref('q', 0)], [])
    ).toThrow("Unknown gate 'missing'");
    expect(() =>
      interpreter.resolveQubitRef([new Map()], qref('missing'))
    ).toThrow("Unknown quantum binding 'missing'");

    const measuredScopes = [
      new Map<string, any>([
        ['q', { kind: 'qubit', startIndex: 0, size: 2, measuredIndices: new Set([0]) }]
      ])
    ];
    expect(() => interpreter.resolveQubitRef(measuredScopes, qref('q'))).toThrow(
      "Cannot operate on measured binding 'q'"
    );
    expect(() =>
      interpreter.resolveQubitRef(measuredScopes, qref('q', 0))
    ).toThrow("Cannot operate on measured qubit 'q[0]'");

    expect(
      interpreter.evaluateIf(
        [new Map([['m', { kind: 'bit', size: 1, measured: true, value: '1' }]])],
        { kind: 'if', condition: { kind: 'eq_int', ident: 'm', value: 1 } }
      )
    ).toBe(true);
    expect(
      interpreter.evaluateIf(
        [new Map([['m', { kind: 'bit', size: 2, measured: true, value: '10' }]])],
        { kind: 'if', condition: { kind: 'eq_ket', ident: 'm', bitstring: '10' } }
      )
    ).toBe(true);

    expect(() =>
      interpreter.evaluateRepeatCount(
        scopes,
        { kind: 'repeat', count: { kind: 'float', value: -1 }, loc }
      )
    ).toThrow('Repeat count must evaluate to a non-negative integer');
    expect(() => interpreter.resolveBitstring(scopes, 'missing')).toThrow(
      "Unknown bitstring binding 'missing'"
    );
    expect(interpreter.collectMeasurement(['1', '0'], new StateVector(1))).toBe('10');
  });

  it('executes user-defined gates through the statement dispatcher', () => {
    const interpreter = new Interpreter({
      kind: 'program',
      body: [
        {
          kind: 'gate_def',
          name: 'flip',
          params: ['a'],
          body: [{ kind: 'gate_app', gate: 'X', targets: [qref('a')], loc }],
          loc
        }
      ]
    } as any) as any;
    const state = new StateVector(1);
    const scopes = [
      new Map<string, any>([
        ['q', { kind: 'qubit', startIndex: 0, size: 1, measuredIndices: new Set<number>() }]
      ])
    ];

    interpreter.executeStatement(
      state,
      scopes,
      { kind: 'user_gate_call', name: 'flip', args: [qref('q', 0)], loc },
      []
    );

    expect(state.probabilities()[0]).toBeCloseTo(0, 12);
    expect(state.probabilities()[1]).toBeCloseTo(1, 12);
    expect(scopes).toHaveLength(1);
  });

  it('covers parametric Rz execution and statement-level if blocks', () => {
    const interpreter = new Interpreter({ kind: 'program', body: [] } as any) as any;
    const state = new StateVector(1);
    const scopes = [
      new Map<string, any>([
        ['q', { kind: 'qubit', startIndex: 0, size: 1, measuredIndices: new Set<number>() }],
        ['bit', { kind: 'bit', size: 1, measured: true, value: '1' }]
      ])
    ];

    interpreter.executeStatement(
      state,
      scopes,
      {
        kind: 'param_gate_app',
        gate: 'Ry',
        angle: { kind: 'pi' },
        target: qref('q', 0),
        loc
      },
      []
    );
    interpreter.executeStatement(
      state,
      scopes,
      {
        kind: 'param_gate_app',
        gate: 'Rz',
        angle: { kind: 'pi' },
        target: qref('q', 0),
        loc
      },
      []
    );
    interpreter.executeStatement(
      state,
      scopes,
      {
        kind: 'if',
        condition: { kind: 'eq_int', ident: 'bit', value: 1 },
        body: [{ kind: 'gate_app', gate: 'Z', targets: [qref('q', 0)], loc }],
        loc
      },
      []
    );

    expect(state.probabilities()[0]).toBeCloseTo(0, 12);
    expect(state.probabilities()[1]).toBeCloseTo(1, 12);
    expect(scopes).toHaveLength(1);
  });

  it('covers exported angle evaluation, including all error branches', () => {
    const scopes = [
      new Map<string, any>([
        ['theta', { kind: 'angle', value: Math.PI }],
        ['bit', { kind: 'bit', value: '1' }]
      ])
    ];

    expect(evaluateAngleExpr({ kind: 'pi' }, scopes, 1, 1)).toBe(Math.PI);
    expect(evaluateAngleExpr({ kind: 'int', value: 2 }, scopes, 1, 1)).toBe(2);
    expect(evaluateAngleExpr({ kind: 'float', value: 2.5 }, scopes, 1, 1)).toBe(2.5);
    expect(evaluateAngleExpr({ kind: 'ident', name: 'theta' }, scopes, 1, 1)).toBe(Math.PI);
    expect(
      evaluateAngleExpr(
        {
          kind: 'binop',
          op: '+',
          left: { kind: 'int', value: 1 },
          right: { kind: 'int', value: 2 }
        },
        scopes,
        1,
        1
      )
    ).toBe(3);
    expect(
      evaluateAngleExpr(
        {
          kind: 'binop',
          op: '-',
          left: { kind: 'int', value: 3 },
          right: { kind: 'int', value: 2 }
        },
        scopes,
        1,
        1
      )
    ).toBe(1);
    expect(
      evaluateAngleExpr(
        {
          kind: 'binop',
          op: '*',
          left: { kind: 'int', value: 3 },
          right: { kind: 'int', value: 2 }
        },
        scopes,
        1,
        1
      )
    ).toBe(6);
    expect(
      evaluateAngleExpr(
        {
          kind: 'binop',
          op: '/',
          left: { kind: 'int', value: 6 },
          right: { kind: 'int', value: 2 }
        },
        scopes,
        1,
        1
      )
    ).toBe(3);
    expect(evaluateAngleExpr({ kind: 'sqrt', arg: { kind: 'int', value: 9 } }, scopes, 1, 1)).toBe(3);
    expect(evaluateAngleExpr({ kind: 'floor', arg: { kind: 'float', value: 2.9 } }, scopes, 1, 1)).toBe(2);
    expect(evaluateAngleExpr({ kind: 'ceil', arg: { kind: 'float', value: 2.1 } }, scopes, 1, 1)).toBe(3);
    expect(() => evaluateAngleExpr({ kind: 'ident', name: 'bit' }, scopes, 2, 3)).toThrow(
      "Identifier 'bit' is not an angle"
    );
    expect(() => evaluateAngleExpr({ kind: 'ident', name: 'missing' }, scopes, 2, 3)).toThrow(
      "Unknown identifier 'missing' in angle expression"
    );
    expect(() =>
      evaluateAngleExpr(
        {
          kind: 'binop',
          op: '/',
          left: { kind: 'int', value: 1 },
          right: { kind: 'int', value: 0 }
        },
        scopes,
        1,
        1
      )
    ).toThrow('Division by zero in angle expression');
    expect(() =>
      evaluateAngleExpr(
        {
          kind: 'binop',
          op: '%' as any,
          left: { kind: 'int', value: 1 },
          right: { kind: 'int', value: 2 }
        },
        scopes,
        1,
        1
      )
    ).toThrow("Unsupported angle operator '%'");
  });
});
