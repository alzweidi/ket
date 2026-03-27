# architecture

## repository layout

- [`src`](../../src) contains the compiler, interpreter, qasm emitter, backends, and cli
- [`playground`](../../playground) contains the browser playground
- [`examples`](../../examples) contains runnable sample programs
- [`tests`](../../tests) contains lexer, parser, typechecker, codegen, integration, and config tests
- [`scripts`](../../scripts) contains local development entry points

## execution pipeline

the cli and playground both rely on the same core flow:

1. the lexer tokenises utf-8 source text from `src/lexer`
2. the parser in `src/parser` builds the ast
3. the type checker in `src/typechecker` validates declarations, gate arity, measurement rules, and run arguments
4. the interpreter in `src/interpreter` executes programs locally against the statevector simulator
5. the qasm emitter in `src/codegen` lowers the same ast to openqasm 2.0
6. the backends in `src/backends` either execute locally or submit qasm jobs to ibm quantum

## key modules

`src/shared/compiler.ts`

- owns the compile pipeline from source text to a checked ast

`src/cli`

- exposes `run`, `compile`, `viz`, and `auth`
- reads IBM credentials from the environment, `.env`, or `~/.ket/config`

`src/simulator`

- provides complex numbers, gate matrices, statevector operations, and measurement helpers

`playground/src`

- runs the compiler in a worker and renders the editor, circuit view, qasm output, and results panels

## design notes

- the interpreter and qasm emitter share the same parsed program representation
- source-level backend annotations such as `run bell() on ibm` are preserved in the ast and honoured by the cli unless a command-line override is supplied
- measured qubits are tracked so later quantum operations fail fast instead of silently mutating collapsed state
