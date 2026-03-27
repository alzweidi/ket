export interface SourceLocation {
  line: number;
  column: number;
}

export type AngleExpr =
  | { kind: 'pi' }
  | { kind: 'int'; value: number }
  | { kind: 'float'; value: number }
  | { kind: 'ident'; name: string }
  | { kind: 'binop'; op: '+' | '-' | '*' | '/'; left: AngleExpr; right: AngleExpr }
  | { kind: 'sqrt'; arg: AngleExpr }
  | { kind: 'floor'; arg: AngleExpr }
  | { kind: 'ceil'; arg: AngleExpr };

export interface QubitRef {
  name: string;
  index: number | null;
  loc: SourceLocation;
}

export type ClassicalExpr =
  | { kind: 'eq_ket'; ident: string; bitstring: string }
  | { kind: 'eq_int'; ident: string; value: number };

export type RunArg =
  | { kind: 'ket'; bitstring: string }
  | { kind: 'angle_expr'; expr: AngleExpr };

export type Statement =
  | QubitDeclStmt
  | BitDeclStmt
  | GateAppStmt
  | ParameterizedGateStmt
  | BuiltinAlgoStmt
  | PhaseOracleStmt
  | LetMeasureStmt
  | IfStmt
  | RepeatStmt
  | UserGateCallStmt;

export interface QubitDeclStmt {
  kind: 'qubit_decl';
  name: string;
  size: number | null;
  loc: SourceLocation;
}

export interface BitDeclStmt {
  kind: 'bit_decl';
  name: string;
  size: number | null;
  loc: SourceLocation;
}

export interface GateAppStmt {
  kind: 'gate_app';
  gate: 'H' | 'X' | 'Y' | 'Z' | 'S' | 'T' | 'CNOT' | 'CZ' | 'SWAP' | 'Toffoli';
  targets: QubitRef[];
  loc: SourceLocation;
}

export interface ParameterizedGateStmt {
  kind: 'param_gate_app';
  gate: 'Rx' | 'Ry' | 'Rz';
  angle: AngleExpr;
  target: QubitRef;
  loc: SourceLocation;
}

export interface BuiltinAlgoStmt {
  kind: 'builtin_algo';
  algo: 'diffuse' | 'grover_diffuse' | 'qft';
  target: QubitRef;
  loc: SourceLocation;
}

export interface PhaseOracleStmt {
  kind: 'phase_oracle';
  target: QubitRef;
  matchTarget: { kind: 'ket'; bitstring: string } | { kind: 'ident'; name: string };
  loc: SourceLocation;
}

export interface LetMeasureStmt {
  kind: 'let_measure';
  bindingName: string;
  source: QubitRef;
  loc: SourceLocation;
}

export interface IfStmt {
  kind: 'if';
  condition: ClassicalExpr;
  body: Statement[];
  loc: SourceLocation;
}

export interface RepeatStmt {
  kind: 'repeat';
  count: AngleExpr;
  body: Statement[];
  loc: SourceLocation;
}

export interface UserGateCallStmt {
  kind: 'user_gate_call';
  name: string;
  args: QubitRef[];
  loc: SourceLocation;
}

export interface GateDef {
  kind: 'gate_def';
  name: string;
  params: string[];
  body: Statement[];
  loc: SourceLocation;
}

export interface CircuitParam {
  name: string;
  type: 'qubit' | 'bit' | 'angle' | 'bitstring';
}

export interface CircuitDef {
  kind: 'circuit_def';
  name: string;
  params: CircuitParam[];
  body: Statement[];
  loc: SourceLocation;
}

export interface RunStatement {
  kind: 'run';
  circuit: string;
  args: RunArg[];
  backend: 'local' | 'ibm';
  loc: SourceLocation;
}

export interface Program {
  kind: 'program';
  body: TopLevelNode[];
}

export type TopLevelNode = Statement | GateDef | CircuitDef | RunStatement;
