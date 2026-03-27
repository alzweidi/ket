import { Lexer } from '../lexer/lexer.js';
import { Parser } from '../parser/parser.js';
import type { Program } from '../parser/ast.js';
import { TypeChecker } from '../typechecker/typechecker.js';

export function compileSource(source: string, filename: string): Program {
  const lexer = new Lexer(source, filename);
  const parser = new Parser(lexer.tokenize(), filename);
  const program = parser.parse();
  const typeChecker = new TypeChecker(filename);
  typeChecker.check(program);
  return program;
}

export function parseSource(source: string, filename: string): Program {
  const lexer = new Lexer(source, filename);
  const parser = new Parser(lexer.tokenize(), filename);
  return parser.parse();
}
