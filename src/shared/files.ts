import fs from 'node:fs';

export function readSourceFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}
