# contributing

Build and test from a clean checkout using the packages in the [installation guide](docs/getting-started/installation.md).

```sh
make test
make sanitise
make test-web
```

Compiler warnings are errors. The native suite uses Python’s standard library for analytic reference calculations and a loopback HTTP server for IBM tests. The WebAssembly tests use Node to exercise the released browser module.

When a change affects the shared core or the WebAssembly interface, regenerate the two files in `playground/engine` with Emscripten 4.0.23 and run the parity tests again.

```sh
make wasm
make test-web
make serve
```

Keep comments short, lowercase and in British English. Include a regression test for a change in behaviour. Use a small reproducing circuit when reporting a compiler or simulator issue. [Security reporting](SECURITY.md)
