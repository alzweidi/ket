import type { SourceLocation } from '../parser/ast.js';

export enum KetType {
  Qubit = 'Qubit',
  QReg = 'QReg',
  Bit = 'Bit',
  CReg = 'CReg',
  Angle = 'Angle',
  Bitstring = 'Bitstring'
}

export interface SymbolInfo {
  type: KetType;
  size: number;
  measured: boolean;
  measuredIndices: Set<number>;
  declaredAt: SourceLocation;
  isParam?: boolean;
}

export class SymbolTable {
  private readonly scopes: Map<string, SymbolInfo>[] = [new Map()];

  public pushScope(): void {
    this.scopes.push(new Map());
  }

  public popScope(): void {
    if (this.scopes.length === 1) {
      throw new Error('Cannot pop global scope');
    }
    this.scopes.pop();
  }

  public declare(name: string, info: SymbolInfo): void {
    const scope = this.scopes[this.scopes.length - 1]!;
    if (scope.has(name)) {
      throw new Error(`Symbol '${name}' already declared in current scope`);
    }
    scope.set(name, info);
  }

  public lookup(name: string): SymbolInfo | null {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const entry = this.scopes[index]!.get(name);
      if (entry) {
        return entry;
      }
    }
    return null;
  }

  public markMeasured(name: string, measuredIndex: number | null = null): void {
    for (let scopeIndex = this.scopes.length - 1; scopeIndex >= 0; scopeIndex -= 1) {
      const entry = this.scopes[scopeIndex]!.get(name);
      if (entry) {
        if (measuredIndex === null) {
          for (let bit = 0; bit < entry.size; bit += 1) {
            entry.measuredIndices.add(bit);
          }
        } else {
          entry.measuredIndices.add(measuredIndex);
        }
        entry.measured = entry.measuredIndices.size >= entry.size;
        return;
      }
    }
    throw new Error(`Cannot mark missing symbol '${name}' as measured`);
  }
}
