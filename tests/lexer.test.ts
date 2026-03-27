import { describe, expect, it } from 'vitest';

import { Lexer } from '../src/lexer/lexer.js';
import { TokenType } from '../src/lexer/tokens.js';

describe('Lexer', () => {
  it('tokenizes declarations, gates, and ket literals', () => {
    const tokens = new Lexer('qubit q[3]\nH q[0]\nlet r = measure q\nif r == |101⟩ {\n}\n', 'test.ket').tokenize();
    expect(tokens.map((token) => token.type)).toContain(TokenType.KET_LITERAL);
    expect(tokens.map((token) => token.type)).toContain(TokenType.GATE_H);
    expect(tokens.map((token) => token.type)).toContain(TokenType.MEASURE);
    expect(tokens.map((token) => token.type)).toContain(TokenType.EQ_EQ);
  });

  it('tokenizes pi as a PI token', () => {
    const tokens = new Lexer('Rx(π/2) q[0]\n', 'test.ket').tokenize();
    expect(tokens.some((token) => token.type === TokenType.PI)).toBe(true);
  });

  it('strips comments and preserves newlines', () => {
    const tokens = new Lexer('// comment\nqubit q\n', 'test.ket').tokenize();
    expect(tokens.filter((token) => token.type === TokenType.NEWLINE)).toHaveLength(2);
  });

  it('rejects invalid ket literals', () => {
    expect(() => new Lexer('if r == |102⟩ {\n}\n', 'test.ket').tokenize()).toThrow('LexError');
  });
});
