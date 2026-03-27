export class KetError extends Error {
  public readonly line: number;
  public readonly column: number;
  public readonly filename: string;

  public constructor(message: string, line: number, column: number, filename: string) {
    super(`${filename}:${line}:${column}: ${message}`);
    this.name = 'KetError';
    this.line = line;
    this.column = column;
    this.filename = filename;
  }
}

export class LexError extends KetError {
  public constructor(message: string, line: number, column: number, filename: string) {
    super(`LexError: ${message}`, line, column, filename);
    this.name = 'LexError';
  }
}

export class ParseError extends KetError {
  public constructor(message: string, line: number, column: number, filename: string) {
    super(`ParseError: ${message}`, line, column, filename);
    this.name = 'ParseError';
  }
}

export class TypeError extends KetError {
  public constructor(message: string, line: number, column: number, filename: string) {
    super(`TypeError: ${message}`, line, column, filename);
    this.name = 'TypeError';
  }
}

export class RuntimeError extends KetError {
  public constructor(message: string, line: number, column: number, filename: string) {
    super(`RuntimeError: ${message}`, line, column, filename);
    this.name = 'RuntimeError';
  }
}

export class SimulatorError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SimulatorError';
  }
}

export class IBMError extends Error {
  public readonly statusCode: number;
  public readonly ibmCode: string | undefined;

  public constructor(message: string, statusCode: number, ibmCode?: string) {
    super(message);
    this.name = 'IBMError';
    this.statusCode = statusCode;
    this.ibmCode = ibmCode;
  }
}
