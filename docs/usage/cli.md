# cli usage

## command summary

```text
ket run <file.ket> [--backend <local|ibm>] [--shots <n>]
ket compile <file.ket>
ket viz <file.ket>
ket auth --ibm <token> [--instance <hub/group/project>] [--backend <name>]
```

## run

`ket run` compiles the source file, chooses a backend, and prints measured result frequencies.

backend selection happens in this order:

1. `--backend <local|ibm>`
2. `run ... on ibm` inside the source file
3. local execution

`--shots` defaults to `1024`.

example:

```bash
node dist/ket.js run examples/grover.ket --shots 256
```

## compile

`ket compile` emits openqasm 2.0 to stdout.

```bash
node dist/ket.js compile examples/qft.ket
```

## viz

`ket viz` base64-encodes the local source file and opens the hosted playground at `https://ket-playground.vercel.app/`.

```bash
node dist/ket.js viz examples/teleportation.ket
```

## auth

`ket auth` stores IBM Quantum credentials in `~/.ket/config`.

```bash
node dist/ket.js auth --ibm <token> --instance ibm-q/open/main --backend ibm_brisbane
```

on non-windows systems the file is written with `0600` permissions.

## config sources

ket reads IBM configuration from these sources:

1. shell environment variables
2. a local `.env` file in the current working directory
3. `~/.ket/config`

supported keys:

- `IBM_QUANTUM_TOKEN`
- `IBM_QUANTUM_INSTANCE`
- `IBM_QUANTUM_BACKEND`

## examples

- [`examples/bell-state.ket`](../../examples/bell-state.ket) creates a bell state
- [`examples/grover.ket`](../../examples/grover.ket) runs grover search with a bitstring parameter
- [`examples/qft.ket`](../../examples/qft.ket) applies the built-in qft operation
- [`examples/teleportation.ket`](../../examples/teleportation.ket) shows sequential indexed measurements
