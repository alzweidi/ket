# open-source

## maintainer

ket is maintained by Abedalaziz Alzweidi.

## licence

the repository is licensed under apache-2.0. see [`LICENSE`](../../LICENSE) for the full licence text and [`NOTICE`](../../NOTICE) for project attribution.

## public repository surface

the public-facing repository now includes:

- [`README.md`](../../README.md)
- [`docs`](../../docs)
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
- [`SECURITY.md`](../../SECURITY.md)
- [`LICENSE`](../../LICENSE)
- [`NOTICE`](../../NOTICE)

the old `ket-spec.md` development specification is intentionally removed. the docs folder is now the authoritative public documentation set.

## commit checklist

before committing for public release, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:playground
```

also check that:

- no secrets, tokens, or local `.env` files are staged
- generated output such as `dist/` and `playground/dist/` is not staged unless there is a deliberate release reason
- public docs stay in lower-case headings and British English
- repository-local tool state such as `.claude-flow/` is not committed
