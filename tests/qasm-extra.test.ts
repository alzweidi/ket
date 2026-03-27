import { describe, expect, it } from 'vitest';

import { QasmEmitter } from '../src/codegen/qasm.js';
import { compileSource } from '../src/shared/compiler.js';

const loc = { line: 1, column: 1 };
const qref = (name: string, index: number | null = null) => ({
  name,
  index,
  loc,
});

describe('QasmEmitter internals', () => {
  it('emits gate definitions and top-level programs', () => {
    const program = compileSource(
      'gate bell(a, b) {\nH a\nCNOT a, b\n}\nqubit q[2]\nbell q[0], q[1]\n',
      'emit.ket'
    );
    const qasm = new QasmEmitter().emit(program);
    expect(qasm).toContain('gate bell a, b {');
    expect(qasm).toContain('qreg q[2];');
    expect(qasm).toContain('bell q[0], q[1];');
  });

  it('covers the private entry, register, and formatting helpers', () => {
    const emitter = new QasmEmitter() as any;
    const run = { kind: 'run', circuit: 'demo', args: [], backend: 'local', loc };
    const program = {
      kind: 'program',
      body: [
        { kind: 'qubit_decl', name: 'q', size: 2, loc },
        { kind: 'bit_decl', name: 'c', size: 1, loc },
        {
          kind: 'if',
          condition: { kind: 'eq_int', ident: 'c', value: 1 },
          body: [{ kind: 'let_measure', bindingName: 'm', source: qref('q', 0), loc }],
          loc
        },
        {
          kind: 'repeat',
          count: { kind: 'int', value: 2 },
          body: [{ kind: 'let_measure', bindingName: 'r', source: qref('q'), loc }],
          loc
        }
      ]
    } as any;

    expect(emitter.resolveEntry(program, null).body).toHaveLength(4);
    expect(() =>
      emitter.resolveEntry({ kind: 'program', body: [run] }, run)
    ).toThrow("Unknown circuit 'demo'");

    const registers = emitter.collectRegisters(program.body);
    expect(registers.get('q')).toEqual({ kind: 'qreg', size: 2 });
    expect(registers.get('c')).toEqual({ kind: 'creg', size: 1 });
    expect(registers.get('m')).toEqual({ kind: 'creg', size: 1 });
    expect(registers.get('r')).toEqual({ kind: 'creg', size: 2 });
    expect(
      emitter.collectRegisters([{ kind: 'bit_decl', name: 'flag', size: null, loc }]).get('flag')
    ).toEqual({ kind: 'creg', size: 1 });

    expect(emitter.expandTarget(qref('q'), registers)).toEqual(['q[0]', 'q[1]']);
    expect(emitter.expandTarget(qref('q', 1), registers)).toEqual(['q[1]']);
    expect(emitter.qubitRefSize(registers, qref('missing'))).toBe(1);
    expect(emitter.formatClassicalTarget('m', qref('q'))).toBe('m');
    expect(emitter.formatClassicalTarget('m', qref('q', 0))).toBe('m[0]');
    expect(emitter.formatTarget(qref('q'))).toBe('q');
    expect(emitter.formatTarget(qref('q', 1))).toBe('q[1]');
  });

  it('covers emission branches for statements, gates, and built-ins', () => {
    const emitter = new QasmEmitter() as any;
    const registers = new Map([
      ['q', { kind: 'qreg', size: 4 }],
      ['c', { kind: 'creg', size: 1 }]
    ]);
    const context = { registers, runArgs: new Map() };

    expect(emitter.emitStatement({ kind: 'qubit_decl', name: 'q', size: 1, loc }, context)).toEqual([]);
    expect(emitter.emitStatement({ kind: 'bit_decl', name: 'c', size: 1, loc }, context)).toEqual([]);

    expect(emitter.emitGateApplication('X', [qref('q', 0)], registers, '')).toEqual(['x q[0];']);
    expect(emitter.emitGateApplication('Y', [qref('q', 0)], registers, '')).toEqual(['y q[0];']);
    expect(emitter.emitGateApplication('Z', [qref('q', 0)], registers, '')).toEqual(['z q[0];']);
    expect(emitter.emitGateApplication('S', [qref('q', 0)], registers, '')).toEqual(['s q[0];']);
    expect(emitter.emitGateApplication('T', [qref('q', 0)], registers, '')).toEqual(['t q[0];']);
    expect(emitter.emitGateApplication('CZ', [qref('q', 0), qref('q', 1)], registers, '')).toEqual([
      'cz q[0], q[1];'
    ]);
    expect(emitter.emitGateApplication('SWAP', [qref('q', 0), qref('q', 1)], registers, '')).toEqual([
      'swap q[0], q[1];'
    ]);
    expect(
      emitter.emitGateApplication('Toffoli', [qref('q', 0), qref('q', 1), qref('q', 2)], registers, '')
    ).toEqual(['ccx q[0], q[1], q[2];']);

    expect(
      emitter.emitBuiltinAlgo({ kind: 'builtin_algo', algo: 'qft', target: qref('q'), loc }, registers, '')
        .join('\n')
    ).toContain('cu1(');
    expect(
      emitter.emitBuiltinAlgo({ kind: 'builtin_algo', algo: 'diffuse', target: qref('q'), loc }, registers, '')
        .join('\n')
    ).toContain('h q[0];');

    expect(emitter.emitControlledZ(['q[0]'], '')).toEqual(['z q[0];']);
    expect(emitter.emitControlledZ(['q[0]', 'q[1]'], '')).toEqual(['cz q[0], q[1];']);
    expect(emitter.emitControlledZ(['q[0]', 'q[1]', 'q[2]'], '').join('\n')).toContain('ccx');
    expect(emitter.emitControlledZ(['q[0]', 'q[1]', 'q[2]', 'q[3]'], '')[0]).toContain('multi-controlled Z');

    expect(
      emitter.emitStatement(
        {
          kind: 'if',
          condition: { kind: 'eq_ket', ident: 'c', bitstring: '10' },
          body: [{ kind: 'user_gate_call', name: 'bell', args: [qref('q', 0), qref('q', 1)], loc }],
          loc
        },
        context
      )[0]
    ).toContain('if (c == 2)');
    expect(
      emitter.emitStatement(
        {
          kind: 'if',
          condition: { kind: 'eq_int', ident: 'c', value: 1 },
          body: [{ kind: 'gate_app', gate: 'H', targets: [qref('q', 0)], loc }],
          loc
        },
        context
      )[0]
    ).toContain('if (c == 1)');

    expect(
      emitter.emitStatement(
        {
          kind: 'repeat',
          count: { kind: 'int', value: 2 },
          body: [{ kind: 'gate_app', gate: 'H', targets: [qref('q', 0)], loc }],
          loc
        },
        context
      )[0]
    ).toBe('// repeat 2');
  });

  it('covers angle and phase oracle resolution, including error paths', () => {
    const emitter = new QasmEmitter() as any;
    const runArgs = new Map([
      ['theta', { kind: 'angle', value: Math.PI }],
      ['target', { kind: 'ket', bitstring: '101' }]
    ]);

    expect(emitter.bindRunArgs(
      {
        name: 'demo',
        params: [{ name: 'target', type: 'bitstring' }, { name: 'theta', type: 'angle' }]
      },
      {
        args: [{ kind: 'ket', bitstring: '101' }, { kind: 'angle_expr', expr: { kind: 'pi' } }],
        loc
      }
    ).get('theta')).toEqual({ kind: 'angle', value: Math.PI });

    expect(
      emitter.resolvePhaseOracleTarget(
        { matchTarget: { kind: 'ket', bitstring: '11' } },
        { runArgs: new Map(), registers: new Map() },
        2
      )
    ).toBe('11');
    expect(
      emitter.resolvePhaseOracleTarget(
        { matchTarget: { kind: 'ident', name: 'target' } },
        { runArgs, registers: new Map() },
        3
      )
    ).toBe('101');
    expect(() =>
      emitter.resolvePhaseOracleTarget(
        { matchTarget: { kind: 'ident', name: 'missing' } },
        { runArgs: new Map(), registers: new Map() },
        3
      )
    ).toThrow('unresolved bitstring parameter');
    expect(() =>
      emitter.resolvePhaseOracleTarget(
        { matchTarget: { kind: 'ident', name: 'target' } },
        { runArgs, registers: new Map() },
        2
      )
    ).toThrow('does not match register size 2');

    expect(
      emitter.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '+',
          left: { kind: 'int', value: 1 },
          right: { kind: 'int', value: 2 }
        },
        runArgs,
        1,
        1
      )
    ).toBe(3);
    expect(
      emitter.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '-',
          left: { kind: 'int', value: 3 },
          right: { kind: 'int', value: 2 }
        },
        runArgs,
        1,
        1
      )
    ).toBe(1);
    expect(
      emitter.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '*',
          left: { kind: 'int', value: 3 },
          right: { kind: 'int', value: 2 }
        },
        runArgs,
        1,
        1
      )
    ).toBe(6);
    expect(
      emitter.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '/',
          left: { kind: 'int', value: 6 },
          right: { kind: 'int', value: 2 }
        },
        runArgs,
        1,
        1
      )
    ).toBe(3);
    expect(emitter.evaluateAngleExpr({ kind: 'ident', name: 'theta' }, runArgs, 1, 1)).toBe(Math.PI);
    expect(emitter.evaluateAngleExpr({ kind: 'sqrt', arg: { kind: 'int', value: 9 } }, runArgs, 1, 1)).toBe(3);
    expect(emitter.evaluateAngleExpr({ kind: 'floor', arg: { kind: 'float', value: 2.8 } }, runArgs, 1, 1)).toBe(2);
    expect(emitter.evaluateAngleExpr({ kind: 'ceil', arg: { kind: 'float', value: 2.2 } }, runArgs, 1, 1)).toBe(3);
    expect(() => emitter.evaluateAngleExpr({ kind: 'ident', name: 'missing' }, runArgs, 2, 3)).toThrow(
      "Unknown angle identifier 'missing' at 2:3"
    );
    expect(() =>
      emitter.evaluateAngleExpr(
        {
          kind: 'binop',
          op: '%',
          left: { kind: 'int', value: 1 },
          right: { kind: 'int', value: 2 }
        },
        runArgs,
        4,
        5
      )
    ).toThrow("Unsupported angle operator '%'");
  });
});
