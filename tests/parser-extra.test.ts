import { describe, expect, it } from 'vitest';

import { Lexer } from '../src/lexer/lexer.js';
import { TokenType, type Token } from '../src/lexer/tokens.js';
import { Parser } from '../src/parser/parser.js';

function token(type: TokenType, value = '', line = 1, column = 1): Token {
  return { type, value, line, column };
}

describe('Parser edge cases', () => {
  it('parses the remaining public statement forms', () => {
    const source = [
      'gate bell(a, b) {',
      '  H a',
      '}',
      'circuit demo(target: bitstring, theta: angle, c: bit, q: qubit) {',
      '  bit b[2]',
      '  phase_oracle q matches target',
      '  if b == 1 {',
      '    bell q[0], q[0]',
      '  }',
      '}',
      'run demo(|1⟩, π/2) on ibm',
    ].join('\n');

    const program = new Parser(
      new Lexer(source, 'forms.ket').tokenize(),
      'forms.ket'
    ).parse();
    expect(program.body[0]).toMatchObject({ kind: 'gate_def', name: 'bell' });
    expect(program.body[1]).toMatchObject({
      kind: 'circuit_def',
      name: 'demo',
    });
    expect(program.body[2]).toMatchObject({ kind: 'run', backend: 'ibm' });
  });

  it('covers the parser helper and defensive error branches', () => {
    expect(() =>
      new Parser(
        [token(TokenType.INT, '1'), token(TokenType.EOF)],
        'bad-statement.ket'
      ).parse()
    ).toThrow('Unexpected token INT');

    const qregParser = new Parser(
      [
        token(TokenType.QUBIT, 'qubit'),
        token(TokenType.IDENT, 'q'),
        token(TokenType.LBRACKET, '['),
        token(TokenType.INT, '1'),
        token(TokenType.RBRACKET, ']'),
        token(TokenType.NEWLINE, '\n'),
        token(TokenType.EOF),
      ],
      'qreg.ket'
    ) as any;
    expect(() => qregParser.parseQubitDecl()).toThrow(
      'Register size must be at least 2'
    );

    expect(() =>
      (
        new Parser(
          [token(TokenType.INT, '1'), token(TokenType.EOF)],
          'gate.ket'
        ) as any
      ).parseGateApp()
    ).toThrow('Invalid gate token');
    expect(() =>
      (
        new Parser(
          [token(TokenType.INT, '1'), token(TokenType.EOF)],
          'param.ket'
        ) as any
      ).parseParameterizedGate()
    ).toThrow('Invalid parameterized gate token');
    expect(() =>
      (
        new Parser(
          [token(TokenType.INT, '1'), token(TokenType.EOF)],
          'builtin.ket'
        ) as any
      ).parseBuiltinAlgo()
    ).toThrow('Invalid builtin token');

    const phaseParser = new Parser(
      [
        token(TokenType.PHASE_ORACLE, 'phase_oracle'),
        token(TokenType.IDENT, 'q'),
        token(TokenType.MATCHES, 'matches'),
        token(TokenType.NEWLINE, '\n'),
        token(TokenType.EOF),
      ],
      'phase.ket'
    ) as any;
    expect(() => phaseParser.parsePhaseOracle()).toThrow(
      'Expected ket literal or identifier after matches'
    );
    expect(
      (
        new Parser(
          [
            token(TokenType.PHASE_ORACLE, 'phase_oracle'),
            token(TokenType.IDENT, 'q'),
            token(TokenType.MATCHES, 'matches'),
            token(TokenType.KET_LITERAL, '10'),
            token(TokenType.NEWLINE, '\n'),
            token(TokenType.EOF),
          ],
          'phase-ket.ket'
        ) as any
      ).parsePhaseOracle()
    ).toMatchObject({ matchTarget: { kind: 'ket', bitstring: '10' } });

    const ifParser = new Parser(
      [
        token(TokenType.IDENT, 'r'),
        token(TokenType.EQ_EQ, '=='),
        token(TokenType.IDENT, 'bad'),
        token(TokenType.EOF),
      ],
      'if.ket'
    ) as any;
    expect(() => ifParser.parseClassicalExpr()).toThrow(
      'Expected ket literal or integer in if condition'
    );
    expect(
      (
        new Parser(
          [
            token(TokenType.IDENT, 'r'),
            token(TokenType.EQ_EQ, '=='),
            token(TokenType.KET_LITERAL, '10'),
            token(TokenType.EOF),
          ],
          'if-ket.ket'
        ) as any
      ).parseClassicalExpr()
    ).toEqual({ kind: 'eq_ket', ident: 'r', bitstring: '10' });

    const parser = new Parser(
      [token(TokenType.IDENT, 'bitstring'), token(TokenType.EOF)],
      'helpers.ket'
    ) as any;
    expect(parser.circuitParamTypeFrom(token(TokenType.QUBIT, 'qubit'))).toBe(
      'qubit'
    );
    expect(parser.circuitParamTypeFrom(token(TokenType.BIT, 'bit'))).toBe(
      'bit'
    );
    expect(parser.circuitParamTypeFrom(token(TokenType.ANGLE, 'angle'))).toBe(
      'angle'
    );
    expect(
      parser.circuitParamTypeFrom(token(TokenType.IDENT, 'bitstring'))
    ).toBe('bitstring');
    expect(() =>
      parser.circuitParamTypeFrom(token(TokenType.IDENT, 'complex'))
    ).toThrow("Invalid circuit parameter type 'complex'");
    expect(() =>
      parser.circuitParamTypeFrom(token(TokenType.FLOAT, '1.0'))
    ).toThrow("Invalid circuit parameter type '1.0'");
    expect(
      (
        new Parser(
          [
            token(TokenType.INT, '1'),
            token(TokenType.PLUS, '+'),
            token(TokenType.INT, '2'),
            token(TokenType.MINUS, '-'),
            token(TokenType.INT, '3'),
            token(TokenType.EOF),
          ],
          'binop.ket'
        ) as any
      ).parseAngleExpr()
    ).toEqual({
      kind: 'binop',
      op: '-',
      left: {
        kind: 'binop',
        op: '+',
        left: { kind: 'int', value: 1 },
        right: { kind: 'int', value: 2 }
      },
      right: { kind: 'int', value: 3 }
    });

    expect(() =>
      (
        new Parser(
          [token(TokenType.COMMA, ','), token(TokenType.EOF)],
          'angle.ket'
        ) as any
      ).parseAngleAtom()
    ).toThrow('Unexpected token in angle expression');
    expect(
      (
        new Parser(
          [
            token(TokenType.LPAREN, '('),
            token(TokenType.PI, 'π'),
            token(TokenType.RPAREN, ')'),
            token(TokenType.EOF)
          ],
          'paren.ket'
        ) as any
      ).parseAngleAtom()
    ).toEqual({ kind: 'pi' });
    expect(
      (
        new Parser(
          [
            token(TokenType.CEIL, 'ceil'),
            token(TokenType.LPAREN, '('),
            token(TokenType.FLOAT, '2.1'),
            token(TokenType.RPAREN, ')'),
            token(TokenType.EOF)
          ],
          'ceil.ket'
        ) as any
      ).parseAngleAtom()
    ).toEqual({ kind: 'ceil', arg: { kind: 'float', value: 2.1 } });

    const listParser = new Parser(
      [token(TokenType.RPAREN, ')'), token(TokenType.EOF)],
      'list.ket'
    ) as any;
    expect(listParser.parseIdentifierList(TokenType.RPAREN)).toEqual([]);

    const eofParser = new Parser([token(TokenType.EOF)], 'eof.ket') as any;
    expect(() => eofParser.expectLineEnd()).toThrow('Expected newline');
    expect(() => eofParser.expect(TokenType.NEWLINE)).toThrow(
      'Expected NEWLINE, got EOF'
    );
    expect(eofParser.expectLineEnd(true)).toBeUndefined();
    expect(eofParser.match(TokenType.NEWLINE)).toBe(false);
    expect(eofParser.peek().type).toBe(TokenType.EOF);
    eofParser.pos = 5;
    expect(eofParser.peek().type).toBe(TokenType.EOF);

    const previousParser = new Parser(
      [token(TokenType.NEWLINE, '\n'), token(TokenType.EOF)],
      'previous.ket'
    ) as any;
    expect(previousParser.advance().type).toBe(TokenType.NEWLINE);
    expect(previousParser.previous().type).toBe(TokenType.NEWLINE);
    previousParser.pos = 0;
    previousParser.skipNewlines();
    expect(previousParser.peek().type).toBe(TokenType.EOF);
    expect(previousParser.loc(token(TokenType.IDENT, 'x', 3, 4))).toEqual({
      line: 3,
      column: 4,
    });
    expect(
      previousParser.error('broken', token(TokenType.IDENT, 'x', 9, 2)).message
    ).toContain('previous.ket');
  });
});
