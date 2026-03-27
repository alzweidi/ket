import { LexError } from '../shared/errors.js';
import { KEYWORDS, TokenType, type Token } from './tokens.js';

const MAX_IDENTIFIER_LENGTH = 64;
const MAX_KET_LENGTH = 20;

export class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;

  public constructor(
    private readonly source: string,
    private readonly filename: string
  ) {}

  public tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      const char = this.peek();

      if (char === ' ' || char === '\t') {
        this.advance();
        continue;
      }

      if (char === '\r' || char === '\n') {
        tokens.push(this.lexNewline());
        continue;
      }

      if (char === '/' && this.peek(1) === '/') {
        this.skipComment();
        continue;
      }

      if (char === '|') {
        tokens.push(this.lexKetLiteral());
        continue;
      }

      if (char === 'π') {
        tokens.push(this.makeToken(TokenType.PI, 'π'));
        this.advance();
        continue;
      }

      if (this.isDigit(char)) {
        tokens.push(this.lexNumber());
        continue;
      }

      if (this.isIdentifierStart(char)) {
        tokens.push(this.lexIdentifier());
        continue;
      }

      if (char === '=' && this.peek(1) === '=') {
        const token = this.makeToken(TokenType.EQ_EQ, '==');
        this.advance();
        this.advance();
        tokens.push(token);
        continue;
      }

      const single = this.lexSingleCharacterToken(char);
      if (single !== null) {
        tokens.push(single);
        this.advance();
        continue;
      }

      throw new LexError(`Unexpected character '${char}'`, this.line, this.col, this.filename);
    }

    tokens.push({
      type: TokenType.EOF,
      value: '',
      line: this.line,
      column: this.col
    });

    return tokens;
  }

  private lexNewline(): Token {
    const token = this.makeToken(TokenType.NEWLINE, '\n');
    if (this.peek() === '\r' && this.peek(1) === '\n') {
      this.pos += 2;
    } else {
      this.pos += 1;
    }
    this.line += 1;
    this.col = 1;
    return token;
  }

  private skipComment(): void {
    while (!this.isAtEnd() && this.peek() !== '\n' && this.peek() !== '\r') {
      this.advance();
    }
  }

  private lexKetLiteral(): Token {
    const line = this.line;
    const column = this.col;
    this.advance();

    let bitstring = '';
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === '⟩') {
        /* v8 ignore start -- the per-character length guard below throws before an oversized literal can reach the closing delimiter. */
        if (bitstring.length > MAX_KET_LENGTH) {
          throw new LexError(
            `Ket literal exceeds maximum length of ${MAX_KET_LENGTH}`,
            line,
            column,
            this.filename
          );
        }
        /* v8 ignore stop */
        this.advance();
        return {
          type: TokenType.KET_LITERAL,
          value: bitstring,
          line,
          column
        };
      }

      if (char !== '0' && char !== '1') {
        throw new LexError(`Invalid bit '${char}' in ket literal`, this.line, this.col, this.filename);
      }

      bitstring += char;
      if (bitstring.length > MAX_KET_LENGTH) {
        throw new LexError(
          `Ket literal exceeds maximum length of ${MAX_KET_LENGTH}`,
          line,
          column,
          this.filename
        );
      }
      this.advance();
    }

    throw new LexError('Unterminated ket literal', line, column, this.filename);
  }

  private lexNumber(): Token {
    const line = this.line;
    const column = this.col;
    let raw = '';

    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      raw += this.advance();
    }

    if (this.peek() === '.' && this.isDigit(this.peek(1))) {
      raw += this.advance();
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        raw += this.advance();
      }
      return { type: TokenType.FLOAT, value: raw, line, column };
    }

    return { type: TokenType.INT, value: raw, line, column };
  }

  private lexIdentifier(): Token {
    const line = this.line;
    const column = this.col;
    let raw = '';

    while (!this.isAtEnd() && this.isIdentifierPart(this.peek())) {
      raw += this.advance();
    }

    if (raw.length > MAX_IDENTIFIER_LENGTH) {
      throw new LexError(
        `Identifier '${raw}' exceeds maximum length of ${MAX_IDENTIFIER_LENGTH}`,
        line,
        column,
        this.filename
      );
    }

    return {
      type: KEYWORDS.get(raw) ?? TokenType.IDENT,
      value: raw,
      line,
      column
    };
  }

  private lexSingleCharacterToken(char: string): Token | null {
    const tokenMap: Record<string, TokenType> = {
      '+': TokenType.PLUS,
      '-': TokenType.MINUS,
      '*': TokenType.STAR,
      '/': TokenType.SLASH,
      '=': TokenType.EQUALS,
      '(': TokenType.LPAREN,
      ')': TokenType.RPAREN,
      '[': TokenType.LBRACKET,
      ']': TokenType.RBRACKET,
      '{': TokenType.LBRACE,
      '}': TokenType.RBRACE,
      ',': TokenType.COMMA,
      ':': TokenType.COLON
    };
    const type = tokenMap[char];

    if (!type) {
      return null;
    }

    return this.makeToken(type, char);
  }

  private makeToken(type: TokenType, value: string): Token {
    return {
      type,
      value,
      line: this.line,
      column: this.col
    };
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? '\0';
  }

  private advance(): string {
    const char = this.source[this.pos] ?? '\0';
    this.pos += 1;
    this.col += 1;
    return char;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isIdentifierStart(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
  }

  private isIdentifierPart(char: string): boolean {
    return this.isIdentifierStart(char) || this.isDigit(char);
  }
}
