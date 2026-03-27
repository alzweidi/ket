import { describe, expect, it } from 'vitest';

import { Lexer } from '../src/lexer/lexer.js';
import { TokenType } from '../src/lexer/tokens.js';

describe('Lexer edge cases', () => {
  it('tokenizes carriage returns, floats, keywords, and punctuation', () => {
    const tokens = new Lexer(
      'bit c\r\nangle theta\ncomplex z\n12.5 + - * / = ( ) [ ] { } , :\n',
      'edge.ket'
    ).tokenize();

    expect(tokens.map((token) => token.type)).toEqual(
      expect.arrayContaining([
        TokenType.BIT,
        TokenType.ANGLE,
        TokenType.COMPLEX,
        TokenType.FLOAT,
        TokenType.PLUS,
        TokenType.MINUS,
        TokenType.STAR,
        TokenType.SLASH,
        TokenType.EQUALS,
        TokenType.LPAREN,
        TokenType.RPAREN,
        TokenType.LBRACKET,
        TokenType.RBRACKET,
        TokenType.LBRACE,
        TokenType.RBRACE,
        TokenType.COMMA,
        TokenType.COLON,
        TokenType.EOF,
      ])
    );
  });

  it('rejects malformed identifiers and ket literals', () => {
    expect(() =>
      new Lexer(`${'a'.repeat(65)}\n`, 'long-ident.ket').tokenize()
    ).toThrow('exceeds maximum length');
    expect(() =>
      new Lexer(`|${'1'.repeat(21)}⟩\n`, 'long-ket.ket').tokenize()
    ).toThrow('Ket literal exceeds maximum length');
    expect(() => new Lexer('|101', 'unterminated.ket').tokenize()).toThrow(
      'Unterminated ket literal'
    );
    expect(() => new Lexer('@', 'bad-char.ket').tokenize()).toThrow(
      "Unexpected character '@'"
    );
  });

  it('exposes the private helper behaviour expected by the tokenizer', () => {
    const lexer = new Lexer('12\r\n', 'helpers.ket') as any;

    expect(lexer.lexNumber()).toMatchObject({
      type: TokenType.INT,
      value: '12',
    });
    expect(lexer.lexNewline()).toMatchObject({ type: TokenType.NEWLINE });
    expect(lexer.peek()).toBe('\0');
    expect(lexer.advance()).toBe('\0');
    expect(lexer.isAtEnd()).toBe(true);
    expect(lexer.isDigit('5')).toBe(true);
    expect(lexer.isDigit('x')).toBe(false);
    expect(lexer.isIdentifierStart('_')).toBe(true);
    expect(lexer.isIdentifierPart('7')).toBe(true);
    expect(lexer.lexSingleCharacterToken('?')).toBeNull();
    expect(lexer.makeToken(TokenType.IDENT, 'name')).toMatchObject({
      type: TokenType.IDENT,
      value: 'name',
    });
  });
});
