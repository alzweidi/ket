# installation

## prerequisites

- node.js 20 or later
- pnpm 9 or later

## install and build

```bash
pnpm install
pnpm build
pnpm build:playground
```

the cli bundle is written to `dist/ket.js`. the playground build is written to `playground/dist`.

## run your first program

run one of the included examples locally:

```bash
node dist/ket.js run examples/bell-state.ket --shots 32
```

compile the same source file to openqasm 2.0:

```bash
node dist/ket.js compile examples/bell-state.ket
```

open the hosted playground with a local source file loaded:

```bash
node dist/ket.js viz examples/teleportation.ket
```

## optional ibm quantum setup

store credentials in `~/.ket/config`:

```bash
node dist/ket.js auth --ibm <token> --instance ibm-q/open/main --backend ibm_brisbane
```

or copy the repository example file and fill in the same values:

```bash
cp .env.example .env
```

shell variables and `.env` values override the stored config on read.

## where to go next

- read [../language/overview.md](../language/overview.md) for the language surface
- read [../usage/cli.md](../usage/cli.md) for command details and backend rules
- browse [`examples`](../../examples) for complete sample programs
