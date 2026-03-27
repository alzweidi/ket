import type {
  AngleExpr,
  BuiltinAlgoStmt,
  CircuitDef,
  GateAppStmt,
  GateDef,
  PhaseOracleStmt,
  Program,
  QubitRef,
  RepeatStmt,
  RunArg,
  RunStatement,
  Statement
} from '../parser/ast.js';
import { RuntimeError } from '../shared/errors.js';
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
  gateZ
} from '../simulator/gates.js';
import { measureQubit, measureRegister } from '../simulator/measurement.js';
import { StateVector } from '../simulator/statevector.js';

export interface InterpreterOptions {
  shots: number;
}

export interface SimulationResult {
  counts: Map<string, number>;
  probabilities: Map<string, number>;
  statevector?: StateVector;
}

type RuntimeBinding =
  | { kind: 'qubit'; startIndex: number; size: number; measuredIndices: Set<number>; value?: string }
  | { kind: 'bit'; size: number; measured: boolean; value?: string }
  | { kind: 'bitstring'; value: string }
  | { kind: 'angle'; value: number };

const DEFAULT_OPTIONS: InterpreterOptions = {
  shots: 1
};

export class Interpreter {
  private readonly defs = new Map<string, GateDef | CircuitDef>();

  public constructor(
    private readonly program: Program,
    private readonly options: Partial<InterpreterOptions> = {}
  ) {
    for (const node of program.body) {
      if (node.kind === 'gate_def' || node.kind === 'circuit_def') {
        this.defs.set(node.name, node);
      }
    }
  }

  public run(): SimulationResult {
    const settings = { ...DEFAULT_OPTIONS, ...this.options };
    const runStatement = this.findRunStatement();

    if (settings.shots <= 1) {
      const execution = this.executeSingleRun(runStatement);
      return {
        counts: new Map([[execution.measurement, 1]]),
        probabilities: execution.state.probabilities().reduce((map, probability, index) => {
          if (probability > 0) {
            map.set(index.toString(2).padStart(execution.state.getN(), '0'), probability);
          }
          return map;
        }, new Map<string, number>()),
        statevector: execution.state
      };
    }

    const counts = new Map<string, number>();
    let lastState: StateVector | undefined;
    for (let shot = 0; shot < settings.shots; shot += 1) {
      const execution = this.executeSingleRun(runStatement);
      counts.set(execution.measurement, (counts.get(execution.measurement) ?? 0) + 1);
      lastState = execution.state;
    }

    const probabilities = new Map<string, number>();
    for (const [bitstring, count] of counts.entries()) {
      probabilities.set(bitstring, count / settings.shots);
    }

    /* v8 ignore next 4 -- the multi-shot loop always assigns lastState when shots > 1. */
    if (!lastState) {
      return { counts, probabilities };
    }

    return {
      counts,
      probabilities,
      statevector: lastState
    };
  }

  private executeSingleRun(runStatement: RunStatement | null): { measurement: string; state: StateVector } {
    const bindings = [new Map<string, RuntimeBinding>()];
    const measurementOrder: string[] = [];

    if (runStatement) {
      const circuit = this.defs.get(runStatement.circuit);
      if (!circuit || circuit.kind !== 'circuit_def') {
        throw new RuntimeError(`Unknown circuit '${runStatement.circuit}'`, runStatement.loc.line, runStatement.loc.column, 'runtime');
      }

      this.bindRunArgs(bindings, circuit, runStatement.args);
      const totalQubits = this.scanQubits(circuit.body);
      const state = new StateVector(totalQubits);
      this.allocateDeclarations(bindings, circuit.body);
      this.executeStatements(state, bindings, circuit.body, measurementOrder);
      return {
        measurement: this.collectMeasurement(measurementOrder, state),
        state
      };
    }

    const topLevelStatements = this.program.body.filter((node): node is Statement => node.kind !== 'gate_def' && node.kind !== 'circuit_def' && node.kind !== 'run');
    const state = new StateVector(this.scanQubits(topLevelStatements));
    this.allocateDeclarations(bindings, topLevelStatements);
    this.executeStatements(state, bindings, topLevelStatements, measurementOrder);
    return {
      measurement: this.collectMeasurement(measurementOrder, state),
      state
    };
  }

  private findRunStatement(): RunStatement | null {
    return this.program.body.find((node): node is RunStatement => node.kind === 'run') ?? null;
  }

  private bindRunArgs(scopes: Map<string, RuntimeBinding>[], circuit: CircuitDef, args: RunArg[]): void {
    args.forEach((arg, index) => {
      const param = circuit.params[index]!;
      switch (param.type) {
        case 'bitstring':
          if (arg.kind !== 'ket') {
            throw new RuntimeError(`Expected ket literal for parameter '${param.name}'`, circuit.loc.line, circuit.loc.column, 'runtime');
          }
          scopes[0]!.set(param.name, { kind: 'bitstring', value: arg.bitstring });
          break;
        case 'angle':
          if (arg.kind !== 'angle_expr') {
            throw new RuntimeError(`Expected numeric value for parameter '${param.name}'`, circuit.loc.line, circuit.loc.column, 'runtime');
          }
          scopes[0]!.set(param.name, {
            kind: 'angle',
            value: evaluateAngleExpr(arg.expr, [], circuit.loc.line, circuit.loc.column)
          });
          break;
        default:
          throw new RuntimeError(`Unsupported circuit parameter type '${param.type}'`, circuit.loc.line, circuit.loc.column, 'runtime');
      }
    });
  }

  private scanQubits(statements: Statement[]): number {
    let total = 0;
    for (const stmt of statements) {
      if (stmt.kind === 'qubit_decl') {
        total += stmt.size ?? 1;
      } else if (stmt.kind === 'if' || stmt.kind === 'repeat') {
        total += this.scanQubits(stmt.body);
      }
    }
    return Math.max(total, 1);
  }

  private allocateDeclarations(scopes: Map<string, RuntimeBinding>[], statements: Statement[]): void {
    let nextIndex = 0;
    const walk = (items: Statement[]): void => {
      for (const stmt of items) {
        if (stmt.kind === 'qubit_decl') {
          scopes[0]!.set(stmt.name, {
            kind: 'qubit',
            startIndex: nextIndex,
            size: stmt.size ?? 1,
            measuredIndices: new Set()
          });
          nextIndex += stmt.size ?? 1;
        } else if (stmt.kind === 'bit_decl') {
          scopes[0]!.set(stmt.name, {
            kind: 'bit',
            size: stmt.size ?? 1,
            measured: false
          });
        } else if (stmt.kind === 'if' || stmt.kind === 'repeat') {
          walk(stmt.body);
        }
      }
    };
    walk(statements);
  }

  private executeStatements(
    state: StateVector,
    scopes: Map<string, RuntimeBinding>[],
    statements: Statement[],
    measurementOrder: string[]
  ): void {
    for (const stmt of statements) {
      this.executeStatement(state, scopes, stmt, measurementOrder);
    }
  }

  private executeStatement(
    state: StateVector,
    scopes: Map<string, RuntimeBinding>[],
    stmt: Statement,
    measurementOrder: string[]
  ): void {
    switch (stmt.kind) {
      case 'qubit_decl':
      case 'bit_decl':
        return;
      case 'gate_app':
        this.executeGateApp(state, scopes, stmt);
        return;
      case 'param_gate_app': {
        const target = this.resolveQubitRef(scopes, stmt.target);
        const angle = evaluateAngleExpr(stmt.angle, scopes, stmt.loc.line, stmt.loc.column);
        for (const qubit of target) {
          switch (stmt.gate) {
            case 'Rx':
              state.applySingle(gateRx(angle), qubit);
              break;
            case 'Ry':
              state.applySingle(gateRy(angle), qubit);
              break;
            case 'Rz':
              state.applySingle(gateRz(angle), qubit);
              break;
          }
        }
        return;
      }
      case 'builtin_algo':
        this.executeBuiltin(state, scopes, stmt);
        return;
      case 'phase_oracle':
        this.executePhaseOracle(state, scopes, stmt);
        return;
      case 'let_measure':
        this.executeMeasurement(state, scopes, stmt.bindingName, stmt.source, measurementOrder);
        return;
      case 'if': {
        if (this.evaluateIf(scopes, stmt)) {
          scopes.push(new Map());
          try {
            this.executeStatements(state, scopes, stmt.body, measurementOrder);
          } finally {
            scopes.pop();
          }
        }
        return;
      }
      case 'repeat': {
        const count = this.evaluateRepeatCount(scopes, stmt);
        for (let index = 0; index < count; index += 1) {
          scopes.push(new Map());
          try {
            this.executeStatements(state, scopes, stmt.body, measurementOrder);
          } finally {
            scopes.pop();
          }
        }
        return;
      }
      case 'user_gate_call':
        this.executeUserGateCall(state, scopes, stmt.name, stmt.args, measurementOrder);
        return;
    }
  }

  private executeGateApp(state: StateVector, scopes: Map<string, RuntimeBinding>[], stmt: GateAppStmt): void {
    const targets = stmt.targets.map((target) => this.resolveQubitRef(scopes, target));
    switch (stmt.gate) {
      case 'H':
        targets[0]!.forEach((qubit) => state.applySingle(gateH(), qubit));
        return;
      case 'X':
        targets[0]!.forEach((qubit) => state.applySingle(gateX(), qubit));
        return;
      case 'Y':
        targets[0]!.forEach((qubit) => state.applySingle(gateY(), qubit));
        return;
      case 'Z':
        targets[0]!.forEach((qubit) => state.applySingle(gateZ(), qubit));
        return;
      case 'S':
        targets[0]!.forEach((qubit) => state.applySingle(gateS(), qubit));
        return;
      case 'T':
        targets[0]!.forEach((qubit) => state.applySingle(gateT(), qubit));
        return;
      case 'CNOT':
        state.applyTwo(gateCNOT(), targets[0]![0]!, targets[1]![0]!);
        return;
      case 'CZ':
        state.applyTwo(gateCZ(), targets[0]![0]!, targets[1]![0]!);
        return;
      case 'SWAP':
        state.applyTwo(gateSWAP(), targets[0]![0]!, targets[1]![0]!);
        return;
      case 'Toffoli':
        state.applyThree(gateToffoli(), targets[0]![0]!, targets[1]![0]!, targets[2]![0]!);
        return;
    }
  }

  private executeBuiltin(state: StateVector, scopes: Map<string, RuntimeBinding>[], stmt: BuiltinAlgoStmt): void {
    const qubits = this.resolveQubitRef(scopes, stmt.target);
    if (stmt.algo === 'qft') {
      this.executeQft(state, qubits);
      return;
    }
    this.executeDiffuse(state, qubits);
  }

  private executeDiffuse(state: StateVector, qubits: number[]): void {
    qubits.forEach((qubit) => state.applySingle(gateH(), qubit));
    qubits.forEach((qubit) => state.applySingle(gateX(), qubit));
    this.applyMultiControlledZ(state, qubits);
    qubits.forEach((qubit) => state.applySingle(gateX(), qubit));
    qubits.forEach((qubit) => state.applySingle(gateH(), qubit));
  }

  private executePhaseOracle(state: StateVector, scopes: Map<string, RuntimeBinding>[], stmt: PhaseOracleStmt): void {
    const qubits = this.resolveQubitRef(scopes, stmt.target);
    const target =
      stmt.matchTarget.kind === 'ket' ? stmt.matchTarget.bitstring : this.resolveBitstring(scopes, stmt.matchTarget.name);
    if (target.length !== qubits.length) {
      throw new RuntimeError(
        `phase_oracle target length ${target.length} does not match register size ${qubits.length}`,
        stmt.loc.line,
        stmt.loc.column,
        'runtime'
      );
    }

    qubits.forEach((qubit, index) => {
      if (target[index] === '0') {
        state.applySingle(gateX(), qubit);
      }
    });
    this.applyMultiControlledZ(state, qubits);
    qubits.forEach((qubit, index) => {
      if (target[index] === '0') {
        state.applySingle(gateX(), qubit);
      }
    });
  }

  private executeQft(state: StateVector, qubits: number[]): void {
    for (let j = 0; j < qubits.length; j += 1) {
      const target = qubits[j]!;
      state.applySingle(gateH(), target);
      for (let k = j + 1; k < qubits.length; k += 1) {
        const control = qubits[k]!;
        const theta = (2 * Math.PI) / 2 ** (k - j + 1);
        state.applyControlledSingle(gateRz(theta), control, target);
      }
    }
    for (let index = 0; index < Math.floor(qubits.length / 2); index += 1) {
      state.applyTwo(gateSWAP(), qubits[index]!, qubits[qubits.length - 1 - index]!);
    }
  }

  private applyMultiControlledZ(state: StateVector, qubits: number[]): void {
    if (qubits.length === 1) {
      state.applySingle(gateZ(), qubits[0]!);
      return;
    }
    if (qubits.length === 2) {
      state.applyTwo(gateCZ(), qubits[0]!, qubits[1]!);
      return;
    }
    const target = qubits[qubits.length - 1]!;
    const controls = qubits.slice(0, -1);
    state.applySingle(gateH(), target);
    state.applyMultiControlledX(controls, target);
    state.applySingle(gateH(), target);
  }

  private executeMeasurement(
    state: StateVector,
    scopes: Map<string, RuntimeBinding>[],
    bindingName: string,
    source: QubitRef,
    measurementOrder: string[]
  ): void {
    const binding = this.lookupBinding(scopes, source.name);
    if (!binding || binding.kind !== 'qubit') {
      throw new RuntimeError(`Unknown quantum binding '${source.name}'`, source.loc.line, source.loc.column, 'runtime');
    }

    if (source.index === null) {
      const qubits = this.resolveQubitRef(scopes, source);
      const result = measureRegister(state, qubits);
      this.replaceState(state, result.collapsedState);
      for (let index = 0; index < binding.size; index += 1) {
        binding.measuredIndices.add(index);
      }
      scopes[scopes.length - 1]!.set(bindingName, {
        kind: 'bit',
        size: qubits.length,
        measured: true,
        value: result.bitstring
      });
      measurementOrder.push(result.bitstring);
    } else {
      const result = measureQubit(state, binding.startIndex + source.index);
      this.replaceState(state, result.collapsed);
      binding.measuredIndices.add(source.index);
      scopes[scopes.length - 1]!.set(bindingName, {
        kind: 'bit',
        size: 1,
        measured: true,
        value: String(result.bit)
      });
      measurementOrder.push(String(result.bit));
    }
  }

  private executeUserGateCall(
    state: StateVector,
    scopes: Map<string, RuntimeBinding>[],
    name: string,
    args: QubitRef[],
    measurementOrder: string[]
  ): void {
    const def = this.defs.get(name);
    if (!def || def.kind !== 'gate_def') {
      throw new RuntimeError(`Unknown gate '${name}'`, 1, 1, 'runtime');
    }
    scopes.push(new Map());
    try {
      def.params.forEach((param, index) => {
        const qubit = this.resolveQubitRef(scopes.slice(0, -1), args[index]!)[0]!;
        scopes[scopes.length - 1]!.set(param, {
          kind: 'qubit',
          startIndex: qubit,
          size: 1,
          measuredIndices: new Set()
        });
      });
      this.executeStatements(state, scopes, def.body, measurementOrder);
    } finally {
      scopes.pop();
    }
  }

  private resolveQubitRef(scopes: Map<string, RuntimeBinding>[], ref: QubitRef): number[] {
    const binding = this.lookupBinding(scopes, ref.name);
    if (!binding || binding.kind !== 'qubit') {
      throw new RuntimeError(`Unknown quantum binding '${ref.name}'`, ref.loc.line, ref.loc.column, 'runtime');
    }

    if (ref.index === null) {
      if (binding.measuredIndices.size > 0) {
        throw new RuntimeError(`Cannot operate on measured binding '${ref.name}'`, ref.loc.line, ref.loc.column, 'runtime');
      }
      return Array.from({ length: binding.size }, (_, offset) => binding.startIndex + offset);
    }

    if (binding.measuredIndices.has(ref.index)) {
      throw new RuntimeError(
        `Cannot operate on measured qubit '${ref.name}[${ref.index}]'`,
        ref.loc.line,
        ref.loc.column,
        'runtime'
      );
    }

    return [binding.startIndex + ref.index];
  }

  private evaluateIf(scopes: Map<string, RuntimeBinding>[], stmt: Statement & { kind: 'if' }): boolean {
    const binding = this.lookupBinding(scopes, stmt.condition.ident);
    const value = binding && 'value' in binding ? binding.value : undefined;
    if (!value) {
      return false;
    }
    if (stmt.condition.kind === 'eq_ket') {
      return value === stmt.condition.bitstring;
    }
    return Number.parseInt(String(value), 2) === stmt.condition.value;
  }

  private evaluateRepeatCount(scopes: Map<string, RuntimeBinding>[], stmt: RepeatStmt): number {
    const value = evaluateAngleExpr(stmt.count, scopes, stmt.loc.line, stmt.loc.column);
    if (!Number.isInteger(value) || value < 0) {
      throw new RuntimeError('Repeat count must evaluate to a non-negative integer', stmt.loc.line, stmt.loc.column, 'runtime');
    }
    return value;
  }

  private resolveBitstring(scopes: Map<string, RuntimeBinding>[], name: string): string {
    const binding = this.lookupBinding(scopes, name);
    if (!binding || binding.kind !== 'bitstring') {
      throw new RuntimeError(`Unknown bitstring binding '${name}'`, 1, 1, 'runtime');
    }
    return binding.value;
  }

  private collectMeasurement(measurementOrder: string[], state: StateVector): string {
    if (measurementOrder.length > 0) {
      return measurementOrder.join('');
    }

    const result = measureRegister(state, Array.from({ length: state.getN() }, (_, index) => index));
    this.replaceState(state, result.collapsedState);
    return result.bitstring;
  }

  private replaceState(target: StateVector, next: StateVector): void {
    target.replaceWith(next);
  }

  private lookupBinding(scopes: Map<string, RuntimeBinding>[], name: string): RuntimeBinding | null {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const binding = scopes[index]!.get(name);
      if (binding) {
        return binding;
      }
    }
    return null;
  }
}

export function evaluateAngleExpr(
  expr: AngleExpr,
  scopes: Map<string, RuntimeBinding>[],
  line: number,
  column: number
): number {
  switch (expr.kind) {
    case 'pi':
      return Math.PI;
    case 'int':
    case 'float':
      return expr.value;
    case 'ident': {
      for (let index = scopes.length - 1; index >= 0; index -= 1) {
        const binding = scopes[index]!.get(expr.name);
        if (!binding) {
          continue;
        }
        if (binding.kind !== 'angle') {
          throw new RuntimeError(`Identifier '${expr.name}' is not an angle`, line, column, 'runtime');
        }
        return binding.value;
      }
      throw new RuntimeError(`Unknown identifier '${expr.name}' in angle expression`, line, column, 'runtime');
    }
    case 'binop': {
      const left = evaluateAngleExpr(expr.left, scopes, line, column);
      const right = evaluateAngleExpr(expr.right, scopes, line, column);
      switch (expr.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          if (right === 0) {
            throw new RuntimeError('Division by zero in angle expression', line, column, 'runtime');
          }
          return left / right;
        default:
          throw new RuntimeError(`Unsupported angle operator '${expr.op}'`, line, column, 'runtime');
      }
    }
    case 'sqrt':
      return Math.sqrt(evaluateAngleExpr(expr.arg, scopes, line, column));
    case 'floor':
      return Math.floor(evaluateAngleExpr(expr.arg, scopes, line, column));
    case 'ceil':
      return Math.ceil(evaluateAngleExpr(expr.arg, scopes, line, column));
  }
}
