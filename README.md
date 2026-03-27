# ket

ket is a small quantum programming language, simulator, and cli written in typescript. it can interpret `.ket` programs locally, compile them to openqasm 2.0, submit qasm jobs to ibm quantum, and open a hosted browser playground for interactive work.

## status

ket is an experimental but usable quantum toolchain. the repository is prepared for public collaboration, and the docs in [`docs/README.md`](./docs/README.md) are the authoritative public reference for the current implementation.

## features

- utf-8 lexer and recursive-descent parser for `.ket` source files
- type checker for qubits, classical bits, user-defined gates, and circuits
- local statevector simulator with built-in grover diffusion, phase oracle, and qft support
- openqasm 2.0 emitter
- cli commands for `run`, `compile`, `viz`, and `auth`
- vite/react playground for editing, circuit visualisation, and result inspection

## quick start

```bash
pnpm install
pnpm build
node dist/ket.js run examples/bell-state.ket --shots 32
```

## language example

```ket
circuit bell_state() {
  qubit q[2]

  H q[0]
  CNOT q[0], q[1]

  let r = measure q
}

run bell_state()
```

compile a program to openqasm:

```bash
node dist/ket.js compile examples/qft.ket
```

open the playground with a program loaded:

```bash
node dist/ket.js viz examples/teleportation.ket
```

## ibm quantum setup

store your ibm quantum token and optional defaults:

```bash
node dist/ket.js auth --ibm <token> --instance ibm-q/open/main --backend ibm_brisbane
```

you can also provide the same values through your shell environment or a local `.env` file:

```bash
cp .env.example .env
```

`ket run` resolves the execution backend in this order:

- `--backend <local|ibm>`
- `run ... on ibm` in the source program
- local execution by default

values from the shell or `.env` override `~/.ket/config`. when you use `ket auth`, the config file is created with owner-only permissions on non-windows systems.

## development

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:playground
```

`pnpm dev` starts the workspace development flow:

- the vite playground dev server from [`playground`](./playground)
- the cli bundle watcher that rebuilds `dist/ket.js`

for direct cli execution in typescript, use:

```bash
pnpm dev:cli -- run examples/bell-state.ket --shots 32
```

## project layout

- [`src`](./src) contains the lexer, parser, type checker, simulator, code generator, backends, and cli
- [`playground`](./playground) contains the browser playground
- [`examples`](./examples) contains runnable sample programs
- [`tests`](./tests) contains the automated test suite

## docs

- [`docs/README.md`](./docs/README.md) is the documentation index
- [`docs/getting-started/installation.md`](./docs/getting-started/installation.md) covers setup and first runs
- [`docs/language/overview.md`](./docs/language/overview.md) explains the language surface
- [`docs/usage/cli.md`](./docs/usage/cli.md) documents the cli and playground entry points
- [`docs/codebase/architecture.md`](./docs/codebase/architecture.md) explains the codebase layout and execution pipeline
- [`docs/project/open-source.md`](./docs/project/open-source.md) covers open-source and commit hygiene
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) explains the contribution workflow
- [`SECURITY.md`](./SECURITY.md) explains how to report vulnerabilities

## maintainer

ket is maintained by Abedalaziz Alzweidi.

## licence

this project is released under the apache-2.0 licence. see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
