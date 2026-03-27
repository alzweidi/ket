import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readConfigFrom } from '../src/cli/config.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('cli config', () => {
  it('reads ibm settings from a local .env file', () => {
    const tempDir = makeTempDir('ket-dotenv-');

    fs.writeFileSync(
      path.join(tempDir, '.env'),
      [
        'IBM_QUANTUM_TOKEN=from-dotenv',
        'IBM_QUANTUM_INSTANCE=ibm-q/open/main',
        'IBM_QUANTUM_BACKEND=ibm_osaka',
      ].join('\n'),
      'utf8'
    );

    expect(
      readConfigFrom({
        cwd: tempDir,
        env: {},
        homeDir: path.join(tempDir, 'home'),
      })
    ).toEqual({
      ibm: {
        token: 'from-dotenv',
        instance: 'ibm-q/open/main',
        backend: 'ibm_osaka',
      },
    });
  });

  it('lets shell environment values override the stored config file', () => {
    const tempDir = makeTempDir('ket-config-');
    const homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(path.join(homeDir, '.ket'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.ket', 'config'),
      JSON.stringify(
        {
          ibm: {
            token: 'from-file',
            instance: 'ibm-q/open/main',
            backend: 'ibm_brisbane',
          },
        },
        null,
        2
      ),
      'utf8'
    );

    expect(
      readConfigFrom({
        cwd: tempDir,
        env: {
          IBM_QUANTUM_TOKEN: 'from-env',
          IBM_QUANTUM_BACKEND: 'ibm_torino',
        },
        homeDir,
      })
    ).toEqual({
      ibm: {
        token: 'from-env',
        instance: 'ibm-q/open/main',
        backend: 'ibm_torino',
      },
    });
  });
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
