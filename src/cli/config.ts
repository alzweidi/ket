import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface IBMConfig {
  token: string;
  instance: string;
  backend: string;
}

export interface KetConfig {
  ibm?: IBMConfig;
}

export function configPath(): string {
  return configPathFrom(os.homedir());
}

export function readConfig(): KetConfig {
  return readConfigFrom({
    cwd: process.cwd(),
    env: process.env,
    homeDir: os.homedir(),
  });
}

export function readConfigFrom(sources: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}): KetConfig {
  const fileConfig = readConfigFile(configPathFrom(sources.homeDir));
  const envFile = readDotEnvFile(sources.cwd);

  const token =
    readEnvValue('IBM_QUANTUM_TOKEN', envFile, sources.env) ??
    fileConfig.ibm?.token;
  if (!token) {
    return fileConfig;
  }

  return {
    ...fileConfig,
    ibm: {
      token,
      instance:
        readEnvValue('IBM_QUANTUM_INSTANCE', envFile, sources.env) ??
        fileConfig.ibm?.instance ??
        'ibm-q/open/main',
      backend:
        readEnvValue('IBM_QUANTUM_BACKEND', envFile, sources.env) ??
        fileConfig.ibm?.backend ??
        'ibm_brisbane',
    },
  };
}

export function writeConfig(config: KetConfig): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
  if (process.platform !== 'win32') {
    fs.chmodSync(file, 0o600);
  }
}

function configPathFrom(homeDir: string): string {
  return path.join(homeDir, '.ket', 'config');
}

function readConfigFile(file: string): KetConfig {
  if (!fs.existsSync(file)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as KetConfig;
}

function readDotEnvFile(cwd: string): Record<string, string> {
  const file = path.join(cwd, '.env');
  if (!fs.existsSync(file)) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function readEnvValue(
  key: 'IBM_QUANTUM_TOKEN' | 'IBM_QUANTUM_INSTANCE' | 'IBM_QUANTUM_BACKEND',
  envFile: Record<string, string>,
  env: NodeJS.ProcessEnv
): string | undefined {
  return env[key] ?? envFile[key];
}
