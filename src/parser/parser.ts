import { ParseError } from '../shared/errors.js';
import { TokenType, type Token } from '../lexer/tokens.js';
import type {
  AngleExpr,
  BitDeclStmt,
  BuiltinAlgoStmt,
  CircuitDef,
  CircuitParam,
  ClassicalExpr,
  GateAppStmt,
  GateDef,
  IfStmt,
  LetMeasureStmt,
  ParameterizedGateStmt,
  PhaseOracleStmt,
  Program,
  QubitDeclStmt,
  QubitRef,
  RepeatStmt,
  RunArg,
  RunStatement,
  SourceLocation,
  Statement,
  TopLevelNode,
  UserGateCallStmt
} from './ast.js';

const BUILTIN_GATE_MAP = new Map<TokenType, GateAppStmt['gate']>([
  [TokenType.GATE_H, 'H'],
  [TokenType.GATE_X, 'X'],
  [TokenType.GATE_Y, 'Y'],
  [TokenType.GATE_Z, 'Z'],
  [TokenType.GATE_S, 'S'],
  [TokenType.GATE_T, 'T'],
  [TokenType.GATE_CNOT, 'CNOT'],
  [TokenType.GATE_CZ, 'CZ'],
  [TokenType.GATE_SWAP, 'SWAP'],
  [TokenType.GATE_TOFFOLI, 'Toffoli']
]);

const PARAM_GATE_MAP = new Map<TokenType, ParameterizedGateStmt['gate']>([
  [TokenType.GATE_RX, 'Rx'],
  [TokenType.GATE_RY, 'Ry'],
  [TokenType.GATE_RZ, 'Rz']
]);

const BUILTIN_ALGO_MAP = new Map<TokenType, BuiltinAlgoStmt['algo']>([
  [TokenType.DIFFUSE, 'diffuse'],
  [TokenType.GROVER_DIFFUSE, 'grover_diffuse'],
  [TokenType.QFT, 'qft']
]);

export class Parser {
  private pos = 0;

  public constructor(
    private readonly tokens: Token[],
    private readonly filename = 'unknown'
  ) {}

  public parse(): Program {
    return this.parseProgram();
  }

  private parseProgram(): Program {
    const body: TopLevelNode[] = [];
    this.skipNewlines();

    while (this.peek().type !== TokenType.EOF) {
      body.push(this.parseTopLevel());
      this.skipNewlines();
    }

    return { kind: 'program', body };
  }

  private parseTopLevel(): TopLevelNode {
    switch (this.peek().type) {
      case TokenType.GATE:
        return this.parseGateDef();
      case TokenType.CIRCUIT:
        return this.parseCircuitDef();
      case TokenType.RUN:
        return this.parseRunStatement();
      default:
        return this.parseStatement();
    }
  }

  private parseStatement(): Statement {
    const token = this.peek();
    switch (token.type) {
      case TokenType.QUBIT:
        return this.parseQubitDecl();
      case TokenType.BIT:
        return this.parseBitDecl();
      case TokenType.LET:
        return this.parseLetMeasure();
      case TokenType.IF:
        return this.parseIfStmt();
      case TokenType.REPEAT:
        return this.parseRepeatStmt();
      case TokenType.DIFFUSE:
      case TokenType.GROVER_DIFFUSE:
      case TokenType.QFT:
        return this.parseBuiltinAlgo();
      case TokenType.PHASE_ORACLE:
        return this.parsePhaseOracle();
      case TokenType.GATE_H:
      case TokenType.GATE_X:
      case TokenType.GATE_Y:
      case TokenType.GATE_Z:
      case TokenType.GATE_S:
      case TokenType.GATE_T:
      case TokenType.GATE_CNOT:
      case TokenType.GATE_CZ:
      case TokenType.GATE_SWAP:
      case TokenType.GATE_TOFFOLI:
        return this.parseGateApp();
      case TokenType.GATE_RX:
      case TokenType.GATE_RY:
      case TokenType.GATE_RZ:
        return this.parseParameterizedGate();
      case TokenType.IDENT:
        return this.parseUserGateCall();
      default:
        throw this.error(`Unexpected token ${token.type}`, token);
    }
  }

  private parseQubitDecl(): QubitDeclStmt {
    const start = this.expect(TokenType.QUBIT);
    const name = this.expect(TokenType.IDENT).value;
    const size = this.parseOptionalSize(start);
    this.expectLineEnd();
    return { kind: 'qubit_decl', name, size, loc: this.loc(start) };
  }

  private parseBitDecl(): BitDeclStmt {
    const start = this.expect(TokenType.BIT);
    const name = this.expect(TokenType.IDENT).value;
    const size = this.parseOptionalSize(start);
    this.expectLineEnd();
    return { kind: 'bit_decl', name, size, loc: this.loc(start) };
  }

  private parseOptionalSize(start: Token): number | null {
    if (!this.match(TokenType.LBRACKET)) {
      return null;
    }

    const sizeToken = this.expect(TokenType.INT);
    const size = Number.parseInt(sizeToken.value, 10);
    if (size < 2) {
      throw this.error('Register size must be at least 2', start);
    }
    this.expect(TokenType.RBRACKET);
    return size;
  }

  private parseGateApp(): GateAppStmt {
    const start = this.advance();
    const gate = BUILTIN_GATE_MAP.get(start.type);
    if (!gate) {
      throw this.error(`Invalid gate token ${start.type}`, start);
    }

    const targets = [this.parseQubitRef()];
    while (this.match(TokenType.COMMA)) {
      targets.push(this.parseQubitRef());
    }

    this.expectLineEnd();
    return { kind: 'gate_app', gate, targets, loc: this.loc(start) };
  }

  private parseParameterizedGate(): ParameterizedGateStmt {
    const start = this.advance();
    const gate = PARAM_GATE_MAP.get(start.type);
    if (!gate) {
      throw this.error(`Invalid parameterized gate token ${start.type}`, start);
    }

    this.expect(TokenType.LPAREN);
    const angle = this.parseAngleExpr();
    this.expect(TokenType.RPAREN);
    const target = this.parseQubitRef();
    this.expectLineEnd();
    return { kind: 'param_gate_app', gate, angle, target, loc: this.loc(start) };
  }

  private parseBuiltinAlgo(): BuiltinAlgoStmt {
    const start = this.advance();
    const algo = BUILTIN_ALGO_MAP.get(start.type);
    if (!algo) {
      throw this.error(`Invalid builtin token ${start.type}`, start);
    }

    const target = this.parseQubitRef();
    this.expectLineEnd();
    return { kind: 'builtin_algo', algo, target, loc: this.loc(start) };
  }

  private parsePhaseOracle(): PhaseOracleStmt {
    const start = this.expect(TokenType.PHASE_ORACLE);
    const target = this.parseQubitRef();
    this.expect(TokenType.MATCHES);
    let matchTarget: PhaseOracleStmt['matchTarget'];
    if (this.match(TokenType.KET_LITERAL)) {
      matchTarget = { kind: 'ket', bitstring: this.previous().value };
    } else if (this.match(TokenType.IDENT)) {
      matchTarget = { kind: 'ident', name: this.previous().value };
    } else {
      throw this.error('Expected ket literal or identifier after matches', this.peek());
    }

    this.expectLineEnd();
    return { kind: 'phase_oracle', target, matchTarget, loc: this.loc(start) };
  }

  private parseLetMeasure(): LetMeasureStmt {
    const start = this.expect(TokenType.LET);
    const bindingName = this.expect(TokenType.IDENT).value;
    this.expect(TokenType.EQUALS);
    this.expect(TokenType.MEASURE);
    const source = this.parseQubitRef();
    this.expectLineEnd();
    return { kind: 'let_measure', bindingName, source, loc: this.loc(start) };
  }

  private parseIfStmt(): IfStmt {
    const start = this.expect(TokenType.IF);
    const condition = this.parseClassicalExpr();
    const body = this.parseBlock();
    return { kind: 'if', condition, body, loc: this.loc(start) };
  }

  private parseClassicalExpr(): ClassicalExpr {
    const ident = this.expect(TokenType.IDENT).value;
    this.expect(TokenType.EQ_EQ);
    if (this.match(TokenType.KET_LITERAL)) {
      return { kind: 'eq_ket', ident, bitstring: this.previous().value };
    }
    if (this.match(TokenType.INT)) {
      return {
        kind: 'eq_int',
        ident,
        value: Number.parseInt(this.previous().value, 10)
      };
    }
    throw this.error('Expected ket literal or integer in if condition', this.peek());
  }

  private parseRepeatStmt(): RepeatStmt {
    const start = this.expect(TokenType.REPEAT);
    const count = this.parseAngleExpr();
    const body = this.parseBlock();
    return { kind: 'repeat', count, body, loc: this.loc(start) };
  }

  private parseBlock(): Statement[] {
    this.expect(TokenType.LBRACE);
    this.expect(TokenType.NEWLINE);
    this.skipNewlines();

    const body: Statement[] = [];
    while (this.peek().type !== TokenType.RBRACE && this.peek().type !== TokenType.EOF) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }

    if (this.peek().type !== TokenType.RBRACE) {
      throw this.error('Expected closing brace', this.peek());
    }

    this.expect(TokenType.RBRACE);
    if (this.peek().type === TokenType.NEWLINE) {
      this.advance();
    }
    return body;
  }

  private parseGateDef(): GateDef {
    const start = this.expect(TokenType.GATE);
    const name = this.expect(TokenType.IDENT).value;
    this.expect(TokenType.LPAREN);
    const params = this.parseIdentifierList(TokenType.RPAREN);
    this.expect(TokenType.RPAREN);
    const body = this.parseBlock();
    return { kind: 'gate_def', name, params, body, loc: this.loc(start) };
  }

  private parseCircuitDef(): CircuitDef {
    const start = this.expect(TokenType.CIRCUIT);
    const name = this.expect(TokenType.IDENT).value;
    this.expect(TokenType.LPAREN);
    const params: CircuitParam[] = [];
    if (this.peek().type !== TokenType.RPAREN) {
      do {
        const paramName = this.expect(TokenType.IDENT).value;
        this.expect(TokenType.COLON);
        const typeToken = this.advance();
        const paramType = this.circuitParamTypeFrom(typeToken);
        params.push({ name: paramName, type: paramType });
      } while (this.match(TokenType.COMMA));
    }
    this.expect(TokenType.RPAREN);
    const body = this.parseBlock();
    return { kind: 'circuit_def', name, params, body, loc: this.loc(start) };
  }

  private circuitParamTypeFrom(token: Token): CircuitParam['type'] {
    switch (token.type) {
      case TokenType.QUBIT:
        return 'qubit';
      case TokenType.BIT:
        return 'bit';
      case TokenType.ANGLE:
        return 'angle';
      case TokenType.IDENT:
        if (token.value === 'bitstring') {
          return 'bitstring';
        }
        break;
      default:
        break;
    }

    throw this.error(`Invalid circuit parameter type '${token.value}'`, token);
  }

  private parseRunStatement(): RunStatement {
    const start = this.expect(TokenType.RUN);
    const circuit = this.expect(TokenType.IDENT).value;
    this.expect(TokenType.LPAREN);
    const args: RunArg[] = [];
    if (this.peek().type !== TokenType.RPAREN) {
      do {
        args.push(this.parseRunArg());
      } while (this.match(TokenType.COMMA));
    }
    this.expect(TokenType.RPAREN);
    let backend: RunStatement['backend'] = 'local';
    if (this.match(TokenType.ON)) {
      this.expect(TokenType.IBM);
      backend = 'ibm';
    }
    this.expectLineEnd(true);
    return { kind: 'run', circuit, args, backend, loc: this.loc(start) };
  }

  private parseRunArg(): RunArg {
    if (this.peek().type === TokenType.KET_LITERAL) {
      return { kind: 'ket', bitstring: this.advance().value };
    }
    return { kind: 'angle_expr', expr: this.parseAngleExpr() };
  }

  private parseUserGateCall(): UserGateCallStmt {
    const start = this.expect(TokenType.IDENT);
    const args = [this.parseQubitRef()];
    while (this.match(TokenType.COMMA)) {
      args.push(this.parseQubitRef());
    }
    this.expectLineEnd();
    return { kind: 'user_gate_call', name: start.value, args, loc: this.loc(start) };
  }

  private parseQubitRef(): QubitRef {
    const ident = this.expect(TokenType.IDENT);
    let index: number | null = null;
    if (this.match(TokenType.LBRACKET)) {
      const idx = this.expect(TokenType.INT);
      index = Number.parseInt(idx.value, 10);
      this.expect(TokenType.RBRACKET);
    }

    return {
      name: ident.value,
      index,
      loc: this.loc(ident)
    };
  }

  private parseIdentifierList(terminator: TokenType): string[] {
    const items: string[] = [];
    if (this.peek().type === terminator) {
      return items;
    }

    do {
      items.push(this.expect(TokenType.IDENT).value);
    } while (this.match(TokenType.COMMA));

    return items;
  }

  private parseAngleExpr(): AngleExpr {
    return this.parseAdditiveExpr();
  }

  private parseAdditiveExpr(): AngleExpr {
    let expr = this.parseMultiplicativeExpr();
    while (this.match(TokenType.PLUS, TokenType.MINUS)) {
      const op = this.previous().type === TokenType.PLUS ? '+' : '-';
      const right = this.parseMultiplicativeExpr();
      expr = { kind: 'binop', op, left: expr, right };
    }
    return expr;
  }

  private parseMultiplicativeExpr(): AngleExpr {
    let expr = this.parseAngleAtom();
    while (this.match(TokenType.STAR, TokenType.SLASH)) {
      const op = this.previous().type === TokenType.STAR ? '*' : '/';
      const right = this.parseAngleAtom();
      expr = { kind: 'binop', op, left: expr, right };
    }
    return expr;
  }

  private parseAngleAtom(): AngleExpr {
    const token = this.advance();
    switch (token.type) {
      case TokenType.PI:
        return { kind: 'pi' };
      case TokenType.INT:
        return { kind: 'int', value: Number.parseInt(token.value, 10) };
      case TokenType.FLOAT:
        return { kind: 'float', value: Number.parseFloat(token.value) };
      case TokenType.IDENT:
        return { kind: 'ident', name: token.value };
      case TokenType.LPAREN: {
        const expr = this.parseAngleExpr();
        this.expect(TokenType.RPAREN);
        return expr;
      }
      case TokenType.SQRT:
      case TokenType.FLOOR:
      case TokenType.CEIL: {
        this.expect(TokenType.LPAREN);
        const arg = this.parseAngleExpr();
        this.expect(TokenType.RPAREN);
        if (token.type === TokenType.SQRT) {
          return { kind: 'sqrt', arg };
        }
        if (token.type === TokenType.FLOOR) {
          return { kind: 'floor', arg };
        }
        return { kind: 'ceil', arg };
      }
      default:
        throw this.error(`Unexpected token in angle expression: ${token.type}`, token);
    }
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[this.pos - 1]!;
  }

  private advance(): Token {
    const token = this.peek();
    if (this.pos < this.tokens.length) {
      this.pos += 1;
    }
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw this.error(`Expected ${type}, got ${token.type}`, token);
    }
    this.pos += 1;
    return token;
  }

  private match(...types: TokenType[]): boolean {
    if (types.includes(this.peek().type)) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private skipNewlines(): void {
    while (this.peek().type === TokenType.NEWLINE) {
      this.pos += 1;
    }
  }

  private expectLineEnd(allowEof = false): void {
    if (this.peek().type === TokenType.NEWLINE) {
      this.advance();
      return;
    }
    if (allowEof && this.peek().type === TokenType.EOF) {
      return;
    }
    throw this.error('Expected newline', this.peek());
  }

  private loc(token: Token): SourceLocation {
    return { line: token.line, column: token.column };
  }

  private error(message: string, token: Token): ParseError {
    return new ParseError(message, token.line, token.column, this.filename);
  }
}
