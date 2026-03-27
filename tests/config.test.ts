import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configPath,
  readConfig,
  readConfigFrom,
  writeConfig,
} from '../src/cli/config.js';

const originalPlatform = process.platform;
const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
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

  it('uses the public IBM defaults when only a token is provided', () => {
    const tempDir = makeTempDir('ket-dotenv-defaults-');
    fs.writeFileSync(path.join(tempDir, '.env'), 'IBM_QUANTUM_TOKEN=from-dotenv\n', 'utf8');

    expect(
      readConfigFrom({
        cwd: tempDir,
        env: {},
        homeDir: path.join(tempDir, 'home')
      })
    ).toEqual({
      ibm: {
        token: 'from-dotenv',
        instance: 'ibm-q/open/main',
        backend: 'ibm_brisbane'
      }
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

  it('returns the file config unchanged when no IBM token exists anywhere', () => {
    const tempDir = makeTempDir('ket-empty-');
    const homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(path.join(homeDir, '.ket'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.ket', 'config'),
      JSON.stringify({ other: 'value' }),
      'utf8'
    );

    expect(
      readConfigFrom({
        cwd: tempDir,
        env: {},
        homeDir,
      })
    ).toEqual({ other: 'value' });
  });

  it('parses quoted values and ignores comments or malformed dotenv lines', () => {
    const tempDir = makeTempDir('ket-dotenv-quoted-');
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      [
        '# comment',
        'BROKEN',
        'IBM_QUANTUM_TOKEN="quoted-token"',
        "IBM_QUANTUM_INSTANCE='ibm-q/open/main'",
        'IBM_QUANTUM_BACKEND = ibm_kyoto',
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
        token: 'quoted-token',
        instance: 'ibm-q/open/main',
        backend: 'ibm_kyoto',
      },
    });
  });

  it('uses process cwd and home for readConfig and writeConfig', () => {
    const tempDir = makeTempDir('ket-config-live-');
    const homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(homeDir, { recursive: true });

    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    const chmodSync = vi.spyOn(fs, 'chmodSync');

    writeConfig({
      ibm: {
        token: 'saved',
        instance: 'ibm-q/open/main',
        backend: 'ibm_brisbane',
      },
    });

    expect(configPath()).toBe(path.join(homeDir, '.ket', 'config'));
    expect(readConfig()).toEqual({
      ibm: {
        token: 'saved',
        instance: 'ibm-q/open/main',
        backend: 'ibm_brisbane',
      },
    });
    expect(chmodSync).toHaveBeenCalledWith(
      path.join(homeDir, '.ket', 'config'),
      0o600
    );
  });

  it('skips chmod on windows when writing config files', () => {
    const tempDir = makeTempDir('ket-config-win32-');
    const homeDir = path.join(tempDir, 'home');
    fs.mkdirSync(homeDir, { recursive: true });

    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    const chmodSync = vi.spyOn(fs, 'chmodSync');
    Object.defineProperty(process, 'platform', { value: 'win32' });

    writeConfig({
      ibm: {
        token: 'saved',
        instance: 'ibm-q/open/main',
        backend: 'ibm_brisbane'
      }
    });

    expect(chmodSync).not.toHaveBeenCalled();
  });
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
