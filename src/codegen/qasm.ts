import type {
  AngleExpr,
  BuiltinAlgoStmt,
  CircuitDef,
  GateDef,
  PhaseOracleStmt,
  Program,
  QubitRef,
  RunStatement,
  Statement
} from '../parser/ast.js';

type RegisterInfo = { kind: 'qreg' | 'creg'; size: number };
type BoundRunArg =
  | { kind: 'ket'; bitstring: string }
  | { kind: 'angle'; value: number };
type EmissionContext = {
  registers: Map<string, RegisterInfo>;
  runArgs: Map<string, BoundRunArg>;
};

export class QasmEmitter {
  public emit(program: Program): string {
    const gateDefs = program.body.filter((node): node is GateDef => node.kind === 'gate_def');
    const run = program.body.find((node): node is RunStatement => node.kind === 'run') ?? null;
    const { body, runArgs } = this.resolveEntry(program, run);

    const registers = this.collectRegisters(body);
    const context: EmissionContext = { registers, runArgs };
    const lines: string[] = ['OPENQASM 2.0;', 'include "qelib1.inc";', ''];

    for (const gate of gateDefs) {
      lines.push(...this.emitGateDef(gate), '');
    }

    for (const [name, info] of registers.entries()) {
      lines.push(`${info.kind} ${name}[${info.size}];`);
    }

    if (registers.size > 0) {
      lines.push('');
    }

    for (const stmt of body) {
      lines.push(...this.emitStatement(stmt, context));
    }

    return `${lines.join('\n').trimEnd()}\n`;
  }

  private resolveEntry(program: Program, run: RunStatement | null): {
    body: Statement[];
    runArgs: Map<string, BoundRunArg>;
  } {
    if (run) {
      const circuit = program.body.find(
        (node): node is CircuitDef => node.kind === 'circuit_def' && node.name === run.circuit
      );
      if (!circuit) {
        throw new Error(`Unknown circuit '${run.circuit}'`);
      }
      return {
        body: circuit.body,
        runArgs: this.bindRunArgs(circuit, run)
      };
    }

    return {
      body: program.body.filter(
        (node): node is Statement => node.kind !== 'gate_def' && node.kind !== 'circuit_def' && node.kind !== 'run'
      ),
      runArgs: new Map()
    };
  }

  private bindRunArgs(circuit: CircuitDef, run: RunStatement): Map<string, BoundRunArg> {
    const args = new Map<string, BoundRunArg>();
    circuit.params.forEach((param, index) => {
      const arg = run.args[index];
      if (arg) {
        if (arg.kind === 'ket') {
          args.set(param.name, arg);
          return;
        }
        args.set(param.name, {
          kind: 'angle',
          value: this.evaluateAngleExpr(arg.expr, args, run.loc.line, run.loc.column)
        });
      }
    });
    return args;
  }

  private collectRegisters(body: Statement[]): Map<string, RegisterInfo> {
    const registers = new Map<string, RegisterInfo>();
    const walk = (statements: Statement[]): void => {
      for (const stmt of statements) {
        switch (stmt.kind) {
          case 'qubit_decl':
            registers.set(stmt.name, { kind: 'qreg', size: stmt.size ?? 1 });
            break;
          case 'bit_decl':
            registers.set(stmt.name, { kind: 'creg', size: stmt.size ?? 1 });
            break;
          case 'let_measure':
            registers.set(stmt.bindingName, {
              kind: 'creg',
              size: stmt.source.index === null ? this.qubitRefSize(registers, stmt.source) : 1
            });
            break;
          case 'if':
          case 'repeat':
            walk(stmt.body);
            break;
          default:
            break;
        }
      }
    };
    walk(body);
    return registers;
  }

  private emitGateDef(def: GateDef): string[] {
    const lines = [`gate ${def.name} ${def.params.join(', ')} {`];
    for (const stmt of def.body) {
      lines.push(...this.emitStatement(stmt, { registers: new Map(), runArgs: new Map() }, '  '));
    }
    lines.push('}');
    return lines;
  }

  private emitStatement(stmt: Statement, context: EmissionContext, indent = ''): string[] {
    switch (stmt.kind) {
      case 'qubit_decl':
      case 'bit_decl':
        return [];
      case 'gate_app':
        return this.emitGateApplication(stmt.gate, stmt.targets, context.registers, indent);
      case 'param_gate_app': {
        const angle = this.evaluateAngleExpr(
          stmt.angle,
          context.runArgs,
          stmt.loc.line,
          stmt.loc.column
        ).toFixed(10);
        return this.emitTargets(
          stmt.target,
          context.registers,
          (target) => `${indent}${stmt.gate.toLowerCase()}(${angle}) ${target};`
        );
      }
      case 'builtin_algo':
        return this.emitBuiltinAlgo(stmt, context.registers, indent);
      case 'phase_oracle':
        return this.emitPhaseOracle(stmt, context, indent);
      case 'let_measure':
        return [
          `${indent}measure ${this.formatTarget(stmt.source)} -> ${this.formatClassicalTarget(
            stmt.bindingName,
            stmt.source
          )};`
        ];
      case 'if': {
        const value =
          stmt.condition.kind === 'eq_ket'
            ? Number.parseInt(stmt.condition.bitstring, 2)
            : stmt.condition.value;
        return stmt.body.flatMap((nested) =>
          this.emitStatement(nested, context, indent).map(
            (line) => `${indent}if (${stmt.condition.ident} == ${value}) ${line.trimStart()}`
          )
        );
      }
      case 'repeat': {
        const count = this.evaluateAngleExpr(stmt.count, context.runArgs, stmt.loc.line, stmt.loc.column);
        const lines = [`${indent}// repeat ${count}`];
        for (let index = 0; index < count; index += 1) {
          for (const nested of stmt.body) {
            lines.push(...this.emitStatement(nested, context, indent));
          }
        }
        return lines;
      }
      case 'user_gate_call':
        return [`${indent}${stmt.name} ${stmt.args.map((arg) => this.formatTarget(arg)).join(', ')};`];
    }
  }

  private emitGateApplication(
    gate: string,
    targets: QubitRef[],
    registers: Map<string, RegisterInfo>,
    indent: string
  ): string[] {
    const gateName =
      gate === 'H'
        ? 'h'
        : gate === 'X'
          ? 'x'
          : gate === 'Y'
            ? 'y'
            : gate === 'Z'
              ? 'z'
              : gate === 'S'
                ? 's'
                : gate === 'T'
                  ? 't'
                  : gate === 'CNOT'
                    ? 'cx'
                    : gate === 'CZ'
                      ? 'cz'
                      : gate === 'SWAP'
                        ? 'swap'
                        : 'ccx';

    if (targets.length === 1) {
      return this.emitTargets(targets[0]!, registers, (target) => `${indent}${gateName} ${target};`);
    }

    return [`${indent}${gateName} ${targets.map((target) => this.formatTarget(target)).join(', ')};`];
  }

  private emitBuiltinAlgo(stmt: BuiltinAlgoStmt, registers: Map<string, RegisterInfo>, indent: string): string[] {
    const qubits = this.expandTarget(stmt.target, registers);
    if (stmt.algo === 'qft') {
      const lines: string[] = [];
      for (let j = 0; j < qubits.length; j += 1) {
        lines.push(`${indent}h ${qubits[j]};`);
        for (let k = j + 1; k < qubits.length; k += 1) {
          const theta = ((2 * Math.PI) / 2 ** (k - j + 1)).toFixed(10);
          lines.push(`${indent}cu1(${theta}) ${qubits[k]}, ${qubits[j]};`);
        }
      }
      for (let index = 0; index < Math.floor(qubits.length / 2); index += 1) {
        lines.push(`${indent}swap ${qubits[index]}, ${qubits[qubits.length - 1 - index]};`);
      }
      return lines;
    }

    return [
      ...qubits.map((qubit) => `${indent}h ${qubit};`),
      ...qubits.map((qubit) => `${indent}x ${qubit};`),
      ...this.emitControlledZ(qubits, indent),
      ...qubits.map((qubit) => `${indent}x ${qubit};`),
      ...qubits.map((qubit) => `${indent}h ${qubit};`)
    ];
  }

  private emitPhaseOracle(stmt: PhaseOracleStmt, context: EmissionContext, indent: string): string[] {
    const qubits = this.expandTarget(stmt.target, context.registers);
    const bitstring = this.resolvePhaseOracleTarget(stmt, context, qubits.length);
    const lines: string[] = [];
    qubits.forEach((qubit, index) => {
      if (bitstring[index] === '0') {
        lines.push(`${indent}x ${qubit};`);
      }
    });
    lines.push(...this.emitControlledZ(qubits, indent));
    qubits.forEach((qubit, index) => {
      if (bitstring[index] === '0') {
        lines.push(`${indent}x ${qubit};`);
      }
    });
    return lines;
  }

  private resolvePhaseOracleTarget(
    stmt: PhaseOracleStmt,
    context: EmissionContext,
    expectedLength: number
  ): string {
    if (stmt.matchTarget.kind === 'ket') {
      return stmt.matchTarget.bitstring;
    }

    const arg = context.runArgs.get(stmt.matchTarget.name);
    if (!arg || arg.kind !== 'ket') {
      throw new Error(
        `Cannot emit phase_oracle for unresolved bitstring parameter '${stmt.matchTarget.name}'`
      );
    }
    if (arg.bitstring.length !== expectedLength) {
      throw new Error(
        `phase_oracle target length ${arg.bitstring.length} does not match register size ${expectedLength}`
      );
    }
    return arg.bitstring;
  }

  private evaluateAngleExpr(
    expr: AngleExpr,
    runArgs: Map<string, BoundRunArg>,
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
        const arg = runArgs.get(expr.name);
        if (!arg || arg.kind !== 'angle') {
          throw new Error(`Unknown angle identifier '${expr.name}' at ${line}:${column}`);
        }
        return arg.value;
      }
      case 'binop': {
        const left = this.evaluateAngleExpr(expr.left, runArgs, line, column);
        const right = this.evaluateAngleExpr(expr.right, runArgs, line, column);
        switch (expr.op) {
          case '+':
            return left + right;
          case '-':
            return left - right;
          case '*':
            return left * right;
          case '/':
            return left / right;
        }
        throw new Error(`Unsupported angle operator '${expr.op}' at ${line}:${column}`);
      }
      case 'sqrt':
        return Math.sqrt(this.evaluateAngleExpr(expr.arg, runArgs, line, column));
      case 'floor':
        return Math.floor(this.evaluateAngleExpr(expr.arg, runArgs, line, column));
      case 'ceil':
        return Math.ceil(this.evaluateAngleExpr(expr.arg, runArgs, line, column));
    }
  }

  private emitControlledZ(qubits: string[], indent: string): string[] {
    if (qubits.length === 1) {
      return [`${indent}z ${qubits[0]};`];
    }
    if (qubits.length === 2) {
      return [`${indent}cz ${qubits[0]}, ${qubits[1]};`];
    }
    if (qubits.length === 3) {
      return [
        `${indent}h ${qubits[2]};`,
        `${indent}ccx ${qubits[0]}, ${qubits[1]}, ${qubits[2]};`,
        `${indent}h ${qubits[2]};`
      ];
    }
    return [`${indent}// multi-controlled Z (n=${qubits.length}) requires decomposition for hardware`];
  }

  private emitTargets(
    ref: QubitRef,
    registers: Map<string, RegisterInfo>,
    render: (target: string) => string
  ): string[] {
    return this.expandTarget(ref, registers).map(render);
  }

  private expandTarget(ref: QubitRef, registers: Map<string, RegisterInfo>): string[] {
    if (ref.index !== null) {
      return [this.formatTarget(ref)];
    }
    const size = this.qubitRefSize(registers, ref);
    return Array.from({ length: size }, (_, index) => `${ref.name}[${index}]`);
  }

  private qubitRefSize(registers: Map<string, RegisterInfo>, ref: QubitRef): number {
    return registers.get(ref.name)?.size ?? 1;
  }

  private formatClassicalTarget(
    bindingName: string,
    source: QubitRef
  ): string {
    if (source.index === null) {
      return bindingName;
    }
    return `${bindingName}[0]`;
  }

  private formatTarget(ref: QubitRef): string {
    return ref.index === null ? ref.name : `${ref.name}[${ref.index}]`;
  }
}
