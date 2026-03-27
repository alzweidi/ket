import { describe, expect, it, vi } from 'vitest';

import { TypeChecker } from '../src/typechecker/typechecker.js';
import { KetType } from '../src/typechecker/types.js';

const loc = { line: 1, column: 1 };
const qref = (name: string, index: number | null = null) => ({
  name,
  index,
  loc
});

function symbolInfo(type: KetType, size = 1, measuredIndices: number[] = []) {
  return {
    type,
    size,
    measured: measuredIndices.length >= size && size > 0,
    measuredIndices: new Set(measuredIndices),
    declaredAt: loc
  };
}

function declare(checker: any, name: string, type: KetType, size = 1, measuredIndices: number[] = []): void {
  checker.declareSymbol(name, symbolInfo(type, size, measuredIndices));
}

describe('TypeChecker internals', () => {
  it('covers definition collection, parameter mapping, and gate validation helpers', () => {
    const checker = new TypeChecker('type-extra.ket') as any;

    checker.collectDefinitions({
      kind: 'program',
      body: [
        { kind: 'gate_def', name: 'bell', params: ['a'], body: [], loc },
        {
          kind: 'circuit_def',
          name: 'demo',
          params: [
            { name: 'q', type: 'qubit' },
            { name: 'flag', type: 'bit' },
            { name: 'theta', type: 'angle' },
            { name: 'target', type: 'bitstring' }
          ],
          body: [],
          loc
        }
      ]
    });

    expect(checker.defs.gates.get('bell')?.name).toBe('bell');
    expect(checker.defs.circuits.get('demo')?.name).toBe('demo');
    expect(checker.paramTypeToSymbolType('qubit')).toBe(KetType.Qubit);
    expect(checker.paramTypeToSymbolType('bit')).toBe(KetType.Bit);
    expect(checker.paramTypeToSymbolType('angle')).toBe(KetType.Angle);
    expect(checker.paramTypeToSymbolType('bitstring')).toBe(KetType.Bitstring);
    expect(() => checker.ensureNameAvailable('bell', 1, 1)).toThrow("Definition name 'bell' is already in use");
    expect(() => checker.ensureNameAvailable('run', 1, 1)).toThrow("Definition name 'run' is already in use");

    checker.defs.gates.set('noop', {
      kind: 'gate_def',
      name: 'noop',
      params: ['x'],
      body: [],
      loc
    });

    expect(() =>
      checker.checkGateDef({
        kind: 'gate_def',
        name: 'outer',
        params: ['a'],
        body: [
          { kind: 'gate_app', gate: 'H', targets: [qref('a')], loc },
          {
            kind: 'param_gate_app',
            gate: 'Rx',
            angle: { kind: 'pi' },
            target: qref('a'),
            loc
          },
          {
            kind: 'repeat',
            count: { kind: 'int', value: 1 },
            body: [{ kind: 'gate_app', gate: 'X', targets: [qref('a')], loc }],
            loc
          },
          { kind: 'user_gate_call', name: 'noop', args: [qref('a')], loc }
        ],
        loc
      })
    ).not.toThrow();

    expect(() =>
      checker.checkGateStatement({ kind: 'qubit_decl', name: 'bad', size: null, loc })
    ).toThrow("Statement 'qubit_decl' is not allowed inside a gate");
    expect(() =>
      checker.checkCircuitDef({
        kind: 'circuit_def',
        name: 'params',
        params: [
          { name: 'q', type: 'qubit' },
          { name: 'flag', type: 'bit' },
          { name: 'theta', type: 'angle' },
          { name: 'target', type: 'bitstring' }
        ],
        body: [],
        loc
      })
    ).not.toThrow();
  });

  it('covers run validation and angle-expression branches', () => {
    const checker = new TypeChecker('type-extra.ket') as any;

    checker.defs.circuits.set('demo', {
      kind: 'circuit_def',
      name: 'demo',
      params: [
        { name: 'target', type: 'bitstring' },
        { name: 'theta', type: 'angle' }
      ],
      body: [],
      loc
    });
    checker.bitstringParamConstraints.set('demo', new Map([['target', 3]]));

    expect(() =>
      checker.checkRun({ kind: 'run', circuit: 'missing', args: [], backend: 'local', loc })
    ).toThrow("Unknown circuit 'missing'");
    expect(() =>
      checker.checkRun({
        kind: 'run',
        circuit: 'demo',
        args: [{ kind: 'ket', bitstring: '101' }],
        backend: 'local',
        loc
      })
    ).toThrow("Circuit 'demo' expects 2 arguments, got 1");
    expect(() =>
      checker.checkRun({
        kind: 'run',
        circuit: 'demo',
        args: [
          { kind: 'angle_expr', expr: { kind: 'pi' } },
          { kind: 'angle_expr', expr: { kind: 'pi' } }
        ],
        backend: 'local',
        loc
      })
    ).toThrow("Circuit parameter 'target' expects a bitstring argument");
    expect(() =>
      checker.checkRun({
        kind: 'run',
        circuit: 'demo',
        args: [
          { kind: 'ket', bitstring: '10' },
          { kind: 'angle_expr', expr: { kind: 'pi' } }
        ],
        backend: 'local',
        loc
      })
    ).toThrow("expects a bitstring of length 3");
    expect(() =>
      checker.checkRun({
        kind: 'run',
        circuit: 'demo',
        args: [
          { kind: 'ket', bitstring: '101' },
          { kind: 'ket', bitstring: '1' }
        ],
        backend: 'local',
        loc
      })
    ).toThrow("Circuit parameter 'theta' expects a numeric argument");
    expect(() =>
      checker.checkRun({
        kind: 'run',
        circuit: 'demo',
        args: [
          { kind: 'ket', bitstring: '101' },
          { kind: 'angle_expr', expr: { kind: 'pi' } }
        ],
        backend: 'local',
        loc
      })
    ).not.toThrow();

    checker.defs.circuits.set('qdemo', {
      kind: 'circuit_def',
      name: 'qdemo',
      params: [{ name: 'q', type: 'qubit' }],
      body: [],
      loc
    });
    expect(() =>
      checker.checkRun({
        kind: 'run',
        circuit: 'qdemo',
        args: [{ kind: 'ket', bitstring: '1' }],
        backend: 'local',
        loc
      })
    ).toThrow("Run arguments for circuit parameter type 'qubit' are not supported in v1.0");

    declare(checker, 'classic_bit', KetType.Bit);
    declare(checker, 'theta', KetType.Angle);

    expect(checker.checkStatement({ kind: 'noop' } as any, 'top-level', false)).toBeUndefined();
    expect(() => checker.evaluateAngleExpr({ kind: 'ident', name: 'missing' }, false)).toThrow(
      "Unknown identifier 'missing' in angle expression"
    );
    expect(() => checker.evaluateAngleExpr({ kind: 'ident', name: 'classic_bit' }, false)).toThrow(
      "Identifier 'classic_bit' is not an angle"
    );
    expect(checker.evaluateAngleExpr({ kind: 'ident', name: 'theta' }, false)).toBeNull();
    expect(
      checker.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '+',
          left: { kind: 'int', value: 1 },
          right: { kind: 'int', value: 2 }
        },
        false
      )
    ).toBe(3);
    expect(
      checker.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '-',
          left: { kind: 'int', value: 3 },
          right: { kind: 'int', value: 2 }
        },
        false
      )
    ).toBe(1);
    expect(
      checker.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '*',
          left: { kind: 'int', value: 3 },
          right: { kind: 'int', value: 2 }
        },
        false
      )
    ).toBe(6);
    expect(
      checker.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '/',
          left: { kind: 'int', value: 6 },
          right: { kind: 'int', value: 2 }
        },
        false
      )
    ).toBe(3);
    expect(
      checker.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '+',
          left: { kind: 'ident', name: 'theta' },
          right: { kind: 'int', value: 1 }
        },
        false
      )
    ).toBeNull();
    expect(
      checker.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '%',
          left: { kind: 'int', value: 1 },
          right: { kind: 'int', value: 2 }
        } as any,
        false
      )
    ).toBeNull();
    expect(checker.evaluateAngleExpr({ kind: 'sqrt', arg: { kind: 'int', value: 9 } }, false)).toBe(3);
    expect(checker.evaluateAngleExpr({ kind: 'sqrt', arg: { kind: 'ident', name: 'theta' } }, false)).toBeNull();
    expect(checker.evaluateAngleExpr({ kind: 'floor', arg: { kind: 'float', value: 2.9 } }, false)).toBe(2);
    expect(checker.evaluateAngleExpr({ kind: 'ceil', arg: { kind: 'float', value: 2.1 } }, false)).toBe(3);
    expect(checker.evaluateAngleExpr({ kind: 'floor', arg: { kind: 'ident', name: 'theta' } }, false)).toBeNull();
    expect(checker.evaluateAngleExpr({ kind: 'ceil', arg: { kind: 'ident', name: 'theta' } }, false)).toBeNull();
    expect(checker.evaluateAngleExpr({ kind: 'mystery' } as any, true)).toBeNull();
    expect(checker.evaluateAngleExpr({ kind: 'mystery' } as any, false)).toBeNull();
  });

  it('covers target validation, measurement, phase oracles, control flow, and user gates', () => {
    const checker = new TypeChecker('type-extra.ket') as any;

    declare(checker, 'q', KetType.QReg, 2);
    declare(checker, 'single', KetType.Qubit);
    declare(checker, 'theta', KetType.Angle);
    declare(checker, 'target', KetType.Bitstring);
    declare(checker, 'bits', KetType.CReg, 2, [0, 1]);
    declare(checker, 'classic_bit', KetType.Bit, 1, [0]);
    declare(checker, 'measured_reg', KetType.QReg, 2, [0]);
    declare(checker, 'partially_measured', KetType.QReg, 2, [1]);

    expect(() =>
      checker.checkStatement(
        { kind: 'bit_decl', name: 'plain_bit', size: null, loc },
        'top-level',
        false
      )
    ).not.toThrow();
    expect(() =>
      checker.checkStatement(
        { kind: 'bit_decl', name: 'plain_creg', size: 2, loc },
        'top-level',
        false
      )
    ).not.toThrow();

    expect(() =>
      checker.assertQuantumTarget(qref('missing'), { allowWholeRegister: true, allowMeasured: true })
    ).toThrow("Unknown identifier 'missing'");
    expect(() =>
      checker.assertQuantumTarget(qref('theta'), { allowWholeRegister: true, allowMeasured: true })
    ).toThrow("Identifier 'theta' is not a quantum value");
    expect(() =>
      checker.assertQuantumTarget(qref('q'), { allowWholeRegister: false, allowMeasured: true })
    ).toThrow("Identifier 'q' must be indexed");
    expect(() =>
      checker.assertQuantumTarget(qref('q', 2), { allowWholeRegister: false, allowMeasured: true })
    ).toThrow("Index 2 is out of bounds for 'q'");
    expect(() =>
      checker.assertQuantumTarget(qref('measured_reg'), { allowWholeRegister: true, allowMeasured: false })
    ).toThrow("Cannot apply operation to measured register 'measured_reg'");
    expect(() =>
      checker.assertQuantumTarget(qref('partially_measured', 1), {
        allowWholeRegister: false,
        allowMeasured: false
      })
    ).toThrow("Cannot apply operation to measured qubit 'partially_measured[1]'");
    expect(
      checker.assertQuantumTarget(qref('q', 1), { allowWholeRegister: false, allowMeasured: true }).type
    ).toBe(KetType.QReg);

    expect(() =>
      checker.checkBuiltInGate({
        kind: 'gate_app',
        gate: 'CNOT',
        targets: [qref('q')],
        loc
      })
    ).toThrow('Gate CNOT expects 2 target(s), got 1');
    expect(() =>
      checker.checkBuiltInGate({
        kind: 'gate_app',
        gate: 'CNOT',
        targets: [qref('q', 0), qref('q', 0)],
        loc
      })
    ).toThrow('Gate CNOT cannot target the same qubit twice');
    expect(() =>
      checker.checkBuiltInGate({
        kind: 'gate_app',
        gate: 'Toffoli',
        targets: [qref('q', 0), qref('q', 1)],
        loc
      })
    ).toThrow('Gate Toffoli expects 3 target(s), got 2');
    expect(() =>
      checker.checkBuiltInGate({
        kind: 'gate_app',
        gate: 'H',
        targets: [qref('single')],
        loc
      })
    ).not.toThrow();

    const builtinChecker = new TypeChecker('type-extra.ket') as any;
    vi.spyOn(builtinChecker, 'assertQuantumTarget').mockReturnValue(symbolInfo(KetType.Bit));
    expect(() =>
      builtinChecker.checkBuiltinAlgo({
        kind: 'builtin_algo',
        algo: 'qft',
        target: qref('single'),
        loc
      })
    ).toThrow('Builtin qft requires a quantum target');

    const indexedGateChecker = new TypeChecker('type-extra.ket') as any;
    vi.spyOn(indexedGateChecker, 'assertQuantumTarget').mockReturnValue(symbolInfo(KetType.QReg, 2));
    expect(() =>
      indexedGateChecker.checkBuiltInGate({
        kind: 'gate_app',
        gate: 'CNOT',
        targets: [qref('q'), qref('q', 1)],
        loc
      })
    ).toThrow('Gate CNOT requires indexed qubit arguments');

    expect(() =>
      checker.checkPhaseOracle({
        kind: 'phase_oracle',
        target: qref('single'),
        matchTarget: { kind: 'ket', bitstring: '1' },
        loc
      })
    ).toThrow('phase_oracle requires a quantum register target');
    expect(() =>
      checker.checkPhaseOracle({
        kind: 'phase_oracle',
        target: qref('q'),
        matchTarget: { kind: 'ket', bitstring: '1' },
        loc
      })
    ).toThrow('phase_oracle target length 1 does not match register size 2');
    expect(() =>
      checker.checkPhaseOracle({
        kind: 'phase_oracle',
        target: qref('q'),
        matchTarget: { kind: 'ket', bitstring: '10' },
        loc
      })
    ).not.toThrow();
    expect(() =>
      checker.checkPhaseOracle({
        kind: 'phase_oracle',
        target: qref('q'),
        matchTarget: { kind: 'ident', name: 'missing' },
        loc
      })
    ).toThrow("phase_oracle match target 'missing' must be a bitstring parameter");
    checker.currentCircuitName = 'oracle';
    checker.bitstringParamConstraints.set('oracle', new Map([['target', 3]]));
    expect(() =>
      checker.checkPhaseOracle({
        kind: 'phase_oracle',
        target: qref('q'),
        matchTarget: { kind: 'ident', name: 'target' },
        loc
      })
    ).toThrow("Bitstring parameter 'target' is used with inconsistent sizes (3 and 2)");
    checker.currentCircuitName = 'oracle_ok';
    checker.bitstringParamConstraints.set('oracle_ok', new Map());
    expect(() =>
      checker.checkPhaseOracle({
        kind: 'phase_oracle',
        target: qref('q'),
        matchTarget: { kind: 'ident', name: 'target' },
        loc
      })
    ).not.toThrow();
    expect(checker.bitstringParamConstraints.get('oracle_ok')?.get('target')).toBe(2);

    expect(() => checker.checkMeasurement('reg_bits', qref('q'), 1, 1)).not.toThrow();
    expect(checker.symbols.lookup('reg_bits')).toMatchObject({
      type: KetType.CReg,
      size: 2,
      measured: true
    });
    declare(checker, 'fresh', KetType.Qubit);
    expect(() => checker.checkMeasurement('bit_result', qref('fresh', 0), 1, 1)).not.toThrow();
    expect(checker.symbols.lookup('bit_result')).toMatchObject({
      type: KetType.Bit,
      size: 1,
      measured: true
    });

    expect(() => checker.checkIf('missing', null, 1, 1)).toThrow("Unknown identifier 'missing'");
    expect(() => checker.checkIf('q', null, 1, 1)).toThrow("Identifier 'q' is not a classical measurement result");
    expect(() => checker.checkIf('bits', 1, 1, 1)).toThrow("Measured register 'bits' has size 2, expected 1");
    expect(() => checker.checkIf('bits', 2, 1, 1)).not.toThrow();
    expect(() =>
      checker.checkStatement(
        {
          kind: 'if',
          condition: { kind: 'eq_ket', ident: 'bits', bitstring: '11' },
          body: [{ kind: 'gate_app', gate: 'H', targets: [qref('single')], loc }],
          loc
        },
        'circuit',
        false
      )
    ).not.toThrow();
    expect(() =>
      checker.checkStatement(
        {
          kind: 'if',
          condition: { kind: 'eq_int', ident: 'classic_bit', value: 1 },
          body: [{ kind: 'gate_app', gate: 'H', targets: [qref('single')], loc }],
          loc
        },
        'circuit',
        false
      )
    ).not.toThrow();

    expect(() =>
      checker.checkStatement(
        {
          kind: 'if',
          condition: { kind: 'eq_int', ident: 'classic_bit', value: 1 },
          body: [{ kind: 'qubit_decl', name: 'inner_q', size: null, loc }],
          loc
        },
        'circuit',
        false
      )
    ).toThrow('Quantum declarations inside if/repeat blocks are not supported');
    expect(() =>
      checker.checkStatement(
        {
          kind: 'repeat',
          count: { kind: 'int', value: 1 },
          body: [{ kind: 'bit_decl', name: 'inner_c', size: null, loc }],
          loc
        },
        'circuit',
        false
      )
    ).toThrow('Classical declarations inside if/repeat blocks are not supported');

    const repeatConst = {
      kind: 'repeat',
      count: { kind: 'int', value: 2 },
      body: [{ kind: 'gate_app', gate: 'H', targets: [qref('single')], loc }],
      loc
    };
    checker.checkStatement(repeatConst, 'circuit', false);
    expect(checker.evaluatedCounts.get(repeatConst)).toBe(2);
    const repeatDynamic = {
      kind: 'repeat',
      count: { kind: 'ident', name: 'theta' },
      body: [{ kind: 'gate_app', gate: 'H', targets: [qref('single')], loc }],
      loc
    };
    checker.checkStatement(repeatDynamic, 'circuit', false);
    expect(checker.evaluatedCounts.has(repeatDynamic)).toBe(false);
    expect(() =>
      checker.checkStatement(
        {
          kind: 'repeat',
          count: { kind: 'float', value: -1 },
          body: [],
          loc
        },
        'circuit',
        false
      )
    ).toThrow('Repeat count must evaluate to a non-negative integer');

    checker.defs.gates.set('pair', {
      kind: 'gate_def',
      name: 'pair',
      params: ['a', 'b'],
      body: [],
      loc
    });
    expect(() => checker.checkUserGateCall('missing', [qref('single')], 1, 1)).toThrow("Unknown gate 'missing'");
    expect(() => checker.checkUserGateCall('pair', [qref('single')], 1, 1)).toThrow(
      "Gate 'pair' expects 2 arguments, got 1"
    );

    const userGateChecker = new TypeChecker('type-extra.ket') as any;
    userGateChecker.defs.gates.set('pair', {
      kind: 'gate_def',
      name: 'pair',
      params: ['a', 'b'],
      body: [],
      loc
    });
    declare(userGateChecker, 'q', KetType.QReg, 2);
    declare(userGateChecker, 'single', KetType.Qubit);
    expect(() => userGateChecker.checkUserGateCall('pair', [qref('q', 0), qref('single')], 1, 1)).not.toThrow();

    const indexedUserGateChecker = new TypeChecker('type-extra.ket') as any;
    indexedUserGateChecker.defs.gates.set('pair', {
      kind: 'gate_def',
      name: 'pair',
      params: ['a', 'b'],
      body: [],
      loc
    });
    vi.spyOn(indexedUserGateChecker, 'assertQuantumTarget').mockReturnValue(symbolInfo(KetType.QReg, 2));
    expect(() =>
      indexedUserGateChecker.checkUserGateCall('pair', [qref('q'), qref('single')], 1, 1)
    ).toThrow("Gate 'pair' requires indexed qubit arguments");
  });

  it('covers declaration failures and missing-symbol measurement errors', () => {
    const checker = new TypeChecker('type-extra.ket') as any;

    expect(() => checker.declareSymbol('run', symbolInfo(KetType.Bit))).toThrow("Identifier 'run' is reserved");
    checker.declareSymbol('dup', symbolInfo(KetType.Bit));
    expect(() => checker.declareSymbol('dup', symbolInfo(KetType.Bit))).toThrow("Identifier 'dup' is already declared");
    expect(() => checker.markMeasured('missing', null)).toThrow("Cannot mark missing symbol 'missing' as measured");

    const errorChecker = new TypeChecker('type-extra.ket') as any;
    vi.spyOn(errorChecker.symbols, 'declare').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => errorChecker.declareSymbol('y', symbolInfo(KetType.Bit))).toThrow('boom');

    const throwingChecker = new TypeChecker('type-extra.ket') as any;
    vi.spyOn(throwingChecker.symbols, 'declare').mockImplementation(() => {
      throw 'boom';
    });
    expect(() => throwingChecker.declareSymbol('x', symbolInfo(KetType.Bit))).toThrow("Unable to declare 'x'");
  });
});
