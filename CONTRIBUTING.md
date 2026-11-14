# contributing

thanks for contributing to ket.

## getting started

for the native c toolchain, use clang or gcc with c17 support, make, and python 3:

```sh
make
make test
make sanitise
```

the [native guide](./docs/native.md) describes the implementation and current limits. keep simulator/exporter semantics in the shared lowered operations, and test quantum behaviour against analytic states or an independent evaluator.

for the typescript cli and playground, use node 20 or later and pnpm:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:playground
```

for local development, `pnpm dev` starts the playground dev server and the cli bundle watcher together.

## workflow

- keep pull requests focused on one change or one closely related set of changes
- add or update tests when behaviour changes
- update the relevant docs in [`docs/README.md`](./docs/README.md) when the cli, language, simulator, or playground changes
- keep markdown headings in lower-case and prefer British English in public-facing docs

## code style

- for native changes, run `make test` and `make sanitise`; compiler warnings are errors
- for typescript changes, run `pnpm lint`, `pnpm typecheck`, and `pnpm test`
- use `pnpm format` for typescript source formatting where needed
- write prose in british english; keep code comments lowercase, brief, and specific
- avoid committing secrets, tokens, local `.env` files, or generated build output

## reporting problems

for non-sensitive bugs or feature requests, open a GitHub issue with a small reproduction if possible.

for security issues, follow the process in [`SECURITY.md`](./SECURITY.md).
