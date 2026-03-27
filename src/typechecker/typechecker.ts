import { RESERVED_KEYWORDS } from '../lexer/tokens.js';
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
  RunStatement,
  Statement
} from '../parser/ast.js';
import { TypeError as KetTypeError } from '../shared/errors.js';
import { KetType, SymbolTable, type SymbolInfo } from './types.js';

type DefinitionMap = {
  gates: Map<string, GateDef>;
  circuits: Map<string, CircuitDef>;
};

export class TypeChecker {
  public readonly evaluatedCounts = new Map<RepeatStmt, number>();
  private readonly symbols = new SymbolTable();
  private readonly defs: DefinitionMap = { gates: new Map(), circuits: new Map() };
  private readonly bitstringParamConstraints = new Map<string, Map<string, number>>();
  private currentCircuitName: string | null = null;

  public constructor(private readonly filename = 'unknown') {}

  public check(program: Program): void {
    this.collectDefinitions(program);

    for (const node of program.body) {
      switch (node.kind) {
        case 'gate_def':
          this.checkGateDef(node);
          break;
        case 'circuit_def':
          this.checkCircuitDef(node);
          break;
        case 'run':
          this.checkRun(node);
          break;
        default:
          this.checkStatement(node, 'top-level', false);
          break;
      }
    }
  }

  private collectDefinitions(program: Program): void {
    for (const node of program.body) {
      if (node.kind === 'gate_def') {
        this.ensureNameAvailable(node.name, node.loc.line, node.loc.column);
        this.defs.gates.set(node.name, node);
      }
      if (node.kind === 'circuit_def') {
        this.ensureNameAvailable(node.name, node.loc.line, node.loc.column);
        this.defs.circuits.set(node.name, node);
      }
    }
  }

  private checkGateDef(def: GateDef): void {
    this.symbols.pushScope();
    try {
      for (const param of def.params) {
        this.declareSymbol(param, {
          type: KetType.Qubit,
          size: 1,
          measured: false,
          measuredIndices: new Set(),
          declaredAt: def.loc,
          isParam: true
        });
      }
      for (const stmt of def.body) {
        this.checkGateStatement(stmt);
      }
    } finally {
      this.symbols.popScope();
    }
  }

  private checkGateStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case 'gate_app':
      case 'param_gate_app':
      case 'repeat':
      case 'user_gate_call':
        this.checkStatement(stmt, 'gate', false);
        return;
      default:
        throw new KetTypeError(
          `Statement '${stmt.kind}' is not allowed inside a gate`,
          stmt.loc.line,
          stmt.loc.column,
          this.filename
        );
    }
  }

  private checkCircuitDef(def: CircuitDef): void {
    this.symbols.pushScope();
    this.currentCircuitName = def.name;
    try {
      for (const param of def.params) {
        this.declareSymbol(param.name, {
          type: this.paramTypeToSymbolType(param.type),
          size: 1,
          measured: param.type === 'bit',
          measuredIndices: param.type === 'bit' ? new Set([0]) : new Set(),
          declaredAt: def.loc,
          isParam: true
        });
      }
      for (const stmt of def.body) {
        this.checkStatement(stmt, 'circuit', false);
      }
    } finally {
      this.currentCircuitName = null;
      this.symbols.popScope();
    }
  }

  private checkRun(run: RunStatement): void {
    const circuit = this.defs.circuits.get(run.circuit);
    if (!circuit) {
      throw new KetTypeError(
        `Unknown circuit '${run.circuit}'`,
        run.loc.line,
        run.loc.column,
        this.filename
      );
    }

    if (circuit.params.length !== run.args.length) {
      throw new KetTypeError(
        `Circuit '${run.circuit}' expects ${circuit.params.length} arguments, got ${run.args.length}`,
        run.loc.line,
        run.loc.column,
        this.filename
      );
    }

    for (const [index, param] of circuit.params.entries()) {
      const arg = run.args[index]!;
      switch (param.type) {
        case 'bitstring':
          if (arg.kind !== 'ket') {
            throw new KetTypeError(
              `Circuit parameter '${param.name}' expects a bitstring argument`,
              run.loc.line,
              run.loc.column,
              this.filename
            );
          }
          {
            const expectedSize = this.bitstringParamConstraints
              .get(run.circuit)
              ?.get(param.name);
            if (expectedSize !== undefined && arg.bitstring.length !== expectedSize) {
              throw new KetTypeError(
                `Circuit parameter '${param.name}' expects a bitstring of length ${expectedSize}, got ${arg.bitstring.length}`,
                run.loc.line,
                run.loc.column,
                this.filename
              );
            }
          }
          break;
        case 'angle':
          if (arg.kind === 'ket') {
            throw new KetTypeError(
              `Circuit parameter '${param.name}' expects a numeric argument`,
              run.loc.line,
              run.loc.column,
              this.filename
            );
          }
          this.evaluateAngleExpr(arg.expr, false);
          break;
        default:
          throw new KetTypeError(
            `Run arguments for circuit parameter type '${param.type}' are not supported in v1.0`,
            run.loc.line,
            run.loc.column,
            this.filename
          );
      }
    }
  }

  private checkStatement(
    stmt: Statement,
    context: 'top-level' | 'gate' | 'circuit',
    inControlFlow: boolean
  ): void {
    switch (stmt.kind) {
      case 'qubit_decl':
        if (inControlFlow) {
          throw new KetTypeError(
            'Quantum declarations inside if/repeat blocks are not supported',
            stmt.loc.line,
            stmt.loc.column,
            this.filename
          );
        }
        this.declareSymbol(stmt.name, {
          type: stmt.size === null ? KetType.Qubit : KetType.QReg,
          size: stmt.size ?? 1,
          measured: false,
          measuredIndices: new Set(),
          declaredAt: stmt.loc
        });
        return;
      case 'bit_decl':
        if (inControlFlow) {
          throw new KetTypeError(
            'Classical declarations inside if/repeat blocks are not supported',
            stmt.loc.line,
            stmt.loc.column,
            this.filename
          );
        }
        this.declareSymbol(stmt.name, {
          type: stmt.size === null ? KetType.Bit : KetType.CReg,
          size: stmt.size ?? 1,
          measured: false,
          measuredIndices: new Set(),
          declaredAt: stmt.loc
        });
        return;
      case 'gate_app':
        this.checkBuiltInGate(stmt);
        return;
      case 'param_gate_app':
        this.evaluateAngleExpr(stmt.angle, false);
        this.assertQuantumTarget(stmt.target, { allowWholeRegister: true, allowMeasured: false });
        return;
      case 'builtin_algo':
        this.checkBuiltinAlgo(stmt);
        return;
      case 'phase_oracle':
        this.checkPhaseOracle(stmt);
        return;
      case 'let_measure':
        this.checkMeasurement(stmt.bindingName, stmt.source, stmt.loc.line, stmt.loc.column);
        return;
      case 'if':
        this.checkIf(stmt.condition.ident, stmt.condition.kind === 'eq_ket' ? stmt.condition.bitstring.length : null, stmt.loc.line, stmt.loc.column);
        this.symbols.pushScope();
        try {
          for (const nested of stmt.body) {
            this.checkStatement(nested, context, true);
          }
        } finally {
          this.symbols.popScope();
        }
        return;
      case 'repeat': {
        const value = this.evaluateAngleExpr(stmt.count, true);
        if (value !== null) {
          if (!Number.isInteger(value) || value < 0) {
            throw new KetTypeError(
              'Repeat count must evaluate to a non-negative integer',
              stmt.loc.line,
              stmt.loc.column,
              this.filename
            );
          }
          this.evaluatedCounts.set(stmt, value);
        }
        this.symbols.pushScope();
        try {
          for (const nested of stmt.body) {
            this.checkStatement(nested, context, true);
          }
        } finally {
          this.symbols.popScope();
        }
        return;
      }
      case 'user_gate_call':
        this.checkUserGateCall(stmt.name, stmt.args, stmt.loc.line, stmt.loc.column);
        return;
      default:
        return;
    }
  }

  private checkBuiltInGate(stmt: GateAppStmt): void {
    const arity =
      stmt.gate === 'Toffoli' ? 3 : stmt.gate === 'CNOT' || stmt.gate === 'CZ' || stmt.gate === 'SWAP' ? 2 : 1;

    if (stmt.targets.length !== arity) {
      throw new KetTypeError(
        `Gate ${stmt.gate} expects ${arity} target(s), got ${stmt.targets.length}`,
        stmt.loc.line,
        stmt.loc.column,
        this.filename
      );
    }

    const keys = new Set<string>();
    for (const target of stmt.targets) {
      const info = this.assertQuantumTarget(target, {
        allowWholeRegister: arity === 1,
        allowMeasured: false
      });
      if (arity > 1 && info.type === KetType.QReg && target.index === null) {
        throw new KetTypeError(
          `Gate ${stmt.gate} requires indexed qubit arguments`,
          target.loc.line,
          target.loc.column,
          this.filename
        );
      }
      const key = this.qubitRefKey(target);
      if (keys.has(key)) {
        throw new KetTypeError(
          `Gate ${stmt.gate} cannot target the same qubit twice`,
          target.loc.line,
          target.loc.column,
          this.filename
        );
      }
      keys.add(key);
    }
  }

  private checkBuiltinAlgo(stmt: BuiltinAlgoStmt): void {
    const info = this.assertQuantumTarget(stmt.target, {
      allowWholeRegister: true,
      allowMeasured: false
    });

    if (info.type !== KetType.QReg && info.type !== KetType.Qubit) {
      throw new KetTypeError(
        `Builtin ${stmt.algo} requires a quantum target`,
        stmt.loc.line,
        stmt.loc.column,
        this.filename
      );
    }
  }

  private checkPhaseOracle(stmt: PhaseOracleStmt): void {
    const info = this.assertQuantumTarget(stmt.target, {
      allowWholeRegister: true,
      allowMeasured: false
    });
    if (info.type !== KetType.QReg) {
      throw new KetTypeError(
        'phase_oracle requires a quantum register target',
        stmt.loc.line,
        stmt.loc.column,
        this.filename
      );
    }

    if (stmt.matchTarget.kind === 'ket') {
      if (stmt.matchTarget.bitstring.length !== info.size) {
        throw new KetTypeError(
          `phase_oracle target length ${stmt.matchTarget.bitstring.length} does not match register size ${info.size}`,
          stmt.loc.line,
          stmt.loc.column,
          this.filename
        );
      }
      return;
    }

    const symbol = this.symbols.lookup(stmt.matchTarget.name);
    if (!symbol || symbol.type !== KetType.Bitstring) {
      throw new KetTypeError(
        `phase_oracle match target '${stmt.matchTarget.name}' must be a bitstring parameter`,
        stmt.loc.line,
        stmt.loc.column,
        this.filename
      );
    }

    if (this.currentCircuitName) {
      const circuitConstraints =
        this.bitstringParamConstraints.get(this.currentCircuitName) ?? new Map<string, number>();
      const existing = circuitConstraints.get(stmt.matchTarget.name);
      if (existing !== undefined && existing !== info.size) {
        throw new KetTypeError(
          `Bitstring parameter '${stmt.matchTarget.name}' is used with inconsistent sizes (${existing} and ${info.size})`,
          stmt.loc.line,
          stmt.loc.column,
          this.filename
        );
      }
      circuitConstraints.set(stmt.matchTarget.name, info.size);
      this.bitstringParamConstraints.set(this.currentCircuitName, circuitConstraints);
    }
  }

  private checkMeasurement(bindingName: string, source: QubitRef, line: number, column: number): void {
    const info = this.assertQuantumTarget(source, { allowWholeRegister: true, allowMeasured: false });
    this.markMeasured(source.name, source.index);
    const measurementSize = source.index === null ? info.size : 1;
    this.declareSymbol(bindingName, {
      type: measurementSize > 1 ? KetType.CReg : KetType.Bit,
      size: measurementSize,
      measured: true,
      measuredIndices: new Set(Array.from({ length: measurementSize }, (_, idx) => idx)),
      declaredAt: { line, column }
    });
  }

  private checkIf(ident: string, expectedSize: number | null, line: number, column: number): void {
    const symbol = this.symbols.lookup(ident);
    if (!symbol) {
      throw new KetTypeError(`Unknown identifier '${ident}'`, line, column, this.filename);
    }
    if (symbol.type !== KetType.Bit && symbol.type !== KetType.CReg) {
      throw new KetTypeError(
        `Identifier '${ident}' is not a classical measurement result`,
        line,
        column,
        this.filename
      );
    }
    if (expectedSize !== null && symbol.size !== expectedSize) {
      throw new KetTypeError(
        `Measured register '${ident}' has size ${symbol.size}, expected ${expectedSize}`,
        line,
        column,
        this.filename
      );
    }
  }

  private checkUserGateCall(name: string, args: QubitRef[], line: number, column: number): void {
    const def = this.defs.gates.get(name);
    if (!def) {
      throw new KetTypeError(`Unknown gate '${name}'`, line, column, this.filename);
    }
    if (def.params.length !== args.length) {
      throw new KetTypeError(
        `Gate '${name}' expects ${def.params.length} arguments, got ${args.length}`,
        line,
        column,
        this.filename
      );
    }
    for (const arg of args) {
      const info = this.assertQuantumTarget(arg, { allowWholeRegister: false, allowMeasured: false });
      if (info.type === KetType.QReg && arg.index === null) {
        throw new KetTypeError(
          `Gate '${name}' requires indexed qubit arguments`,
          arg.loc.line,
          arg.loc.column,
          this.filename
        );
      }
    }
  }

  private evaluateAngleExpr(expr: AngleExpr, constantOnly: boolean): number | null {
    switch (expr.kind) {
      case 'pi':
        return Math.PI;
      case 'int':
      case 'float':
        return expr.value;
      case 'ident': {
        const symbol = this.symbols.lookup(expr.name);
        if (!symbol) {
          throw new KetTypeError(
            `Unknown identifier '${expr.name}' in angle expression`,
            1,
            1,
            this.filename
          );
        }
        if (symbol.type !== KetType.Angle) {
          throw new KetTypeError(
            `Identifier '${expr.name}' is not an angle`,
            1,
            1,
            this.filename
          );
        }
        return null;
      }
      case 'binop': {
        const left = this.evaluateAngleExpr(expr.left, constantOnly);
        const right = this.evaluateAngleExpr(expr.right, constantOnly);
        if (left === null || right === null) {
          return null;
        }
        switch (expr.op) {
          case '+':
            return left + right;
          case '-':
            return left - right;
          case '*':
            return left * right;
          case '/':
            return left / right;
          default:
            return null;
        }
      }
      case 'sqrt': {
        const arg = this.evaluateAngleExpr(expr.arg, constantOnly);
        return arg === null ? null : Math.sqrt(arg);
      }
      case 'floor': {
        const arg = this.evaluateAngleExpr(expr.arg, constantOnly);
        return arg === null ? null : Math.floor(arg);
      }
      case 'ceil': {
        const arg = this.evaluateAngleExpr(expr.arg, constantOnly);
        return arg === null ? null : Math.ceil(arg);
      }
      default:
        return constantOnly ? null : null;
    }
  }

  private assertQuantumTarget(
    ref: QubitRef,
    options: { allowWholeRegister: boolean; allowMeasured: boolean }
  ): SymbolInfo {
    const info = this.symbols.lookup(ref.name);
    if (!info) {
      throw new KetTypeError(`Unknown identifier '${ref.name}'`, ref.loc.line, ref.loc.column, this.filename);
    }
    if (info.type !== KetType.Qubit && info.type !== KetType.QReg) {
      throw new KetTypeError(
        `Identifier '${ref.name}' is not a quantum value`,
        ref.loc.line,
        ref.loc.column,
        this.filename
      );
    }
    if (!options.allowWholeRegister && ref.index === null && info.size > 1) {
      throw new KetTypeError(
        `Identifier '${ref.name}' must be indexed`,
        ref.loc.line,
        ref.loc.column,
        this.filename
      );
    }
    if (ref.index !== null && (ref.index < 0 || ref.index >= info.size)) {
      throw new KetTypeError(
        `Index ${ref.index} is out of bounds for '${ref.name}'`,
        ref.loc.line,
        ref.loc.column,
        this.filename
      );
    }
    if (!options.allowMeasured) {
      if (ref.index === null && info.measuredIndices.size > 0) {
        throw new KetTypeError(
          `Cannot apply operation to measured register '${ref.name}'`,
          ref.loc.line,
          ref.loc.column,
          this.filename
        );
      }
      if (ref.index !== null && info.measuredIndices.has(ref.index)) {
        throw new KetTypeError(
          `Cannot apply operation to measured qubit '${ref.name}[${ref.index}]'`,
          ref.loc.line,
          ref.loc.column,
          this.filename
        );
      }
    }
    return info;
  }

  private qubitRefKey(ref: QubitRef): string {
    return `${ref.name}:${ref.index === null ? '*' : ref.index}`;
  }

  private declareSymbol(name: string, info: SymbolInfo): void {
    if (RESERVED_KEYWORDS.has(name)) {
      throw new KetTypeError(
        `Identifier '${name}' is reserved`,
        info.declaredAt.line,
        info.declaredAt.column,
        this.filename
      );
    }
    if (this.symbols.lookup(name)) {
      throw new KetTypeError(
        `Identifier '${name}' is already declared`,
        info.declaredAt.line,
        info.declaredAt.column,
        this.filename
      );
    }
    try {
      this.symbols.declare(name, info);
    } catch (error) {
      throw new KetTypeError(
        error instanceof Error ? error.message : `Unable to declare '${name}'`,
        info.declaredAt.line,
        info.declaredAt.column,
        this.filename
      );
    }
  }

  private ensureNameAvailable(name: string, line: number, column: number): void {
    if (this.defs.gates.has(name) || this.defs.circuits.has(name) || RESERVED_KEYWORDS.has(name)) {
      throw new KetTypeError(`Definition name '${name}' is already in use`, line, column, this.filename);
    }
  }

  private markMeasured(name: string, index: number | null): void {
    this.symbols.markMeasured(name, index);
  }

  private paramTypeToSymbolType(type: CircuitDef['params'][number]['type']): KetType {
    switch (type) {
      case 'qubit':
        return KetType.Qubit;
      case 'bit':
        return KetType.Bit;
      case 'angle':
        return KetType.Angle;
      case 'bitstring':
        return KetType.Bitstring;
    }
  }
}
