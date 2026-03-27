# contributing

thanks for contributing to ket.

## getting started

use node 20 or later and pnpm.

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

- run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before opening a pull request
- use `pnpm format` for source formatting where needed
- avoid committing secrets, tokens, local `.env` files, or generated build output

## reporting problems

for non-sensitive bugs or feature requests, open a GitHub issue with a small reproduction if possible.

for security issues, follow the process in [`SECURITY.md`](./SECURITY.md).
