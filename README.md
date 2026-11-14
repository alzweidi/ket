# ket

ket is a small language for writing quantum circuits, inspecting their amplitudes, and running measurement experiments.

the native toolchain is written in c17. it checks `.ket` programs, specialises their gates and loops into a circuit, simulates that circuit locally, and exports the same operations to openqasm 2.0. the executable has no third-party runtime dependencies.

## build and run

you need a c17 compiler with complex-number support and `make` (clang or gcc on macos/linux).

```sh
make
./build/ket run examples/bell-state.ket --shots 4096 --seed 42
./build/ket inspect examples/bell-state.ket
./build/ket compile examples/grover.ket -o build/grover.qasm
```

`run` reports sampled counts. `inspect` reports the complex amplitudes before terminal measurements, so interference and phase are visible directly.

## a ket program

```ket
gate entangle(a, b) {
  H a
  CNOT a, b
}

circuit bell() {
  qubit q[2]
  entangle q[0], q[1]
  let result = measure q
}

run bell() on local
```

the first qubit is the leftmost bit: this circuit produces `00` and `11`. use a fixed seed to reproduce a run. use `--json` on `run` or `inspect` for machine-readable results.

## native status

this is the first native implementation, not a complete replacement of every tool in the repository. it supports:

- single-qubit gates, rotations, cnot, cz, swap, and toffoli
- custom unitary gates, angle/bitstring circuit parameters, and bounded repeats
- measurement with classical feed-forward, including [teleportation](./examples/teleportation.ket)
- qft, phase oracles, and grover diffusion lowered to shared primitive operations
- source-location errors, deterministic sampling, and openqasm export

the state-vector simulator supports up to 20 qubits. exact oracle/diffusion expansion is limited to 10 qubits and all circuits to 100,000 expanded operations. unsupported exports fail explicitly.

the native cli runs locally; it does not submit hardware jobs or power the browser playground yet. `compile` emits openqasm, not a cpu executable. see the [native guide](./docs/native.md) for language rules, limits, and the c api.

## development

```sh
make test       # python 3, standard library only
make sanitise   # clang address and undefined-behaviour sanitisers
```

tests compare qft against the analytic fourier transform, grover against its success formula, and exported operations against a separate dense-matrix evaluator. they also exercise teleportation, measurement ordering, compiler limits, malformed input, and file handling.

## typescript implementation and playground

the original implementation remains in [`src`](./src), with the browser app in [`playground`](./playground). it has its own simulator and exporter; it does not use the native core.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

the [typescript installation guide](./docs/getting-started/installation.md) covers its cli, playground, and ibm configuration. the native fixes and limits described above apply to `build/ket`.

## project layout

- [`native`](./native): c frontend, circuit representation, simulator, exporter, and tests
- [`examples`](./examples): runnable quantum programs
- [`src`](./src), [`tests`](./tests), [`playground`](./playground): original typescript implementation
- [`docs`](./docs/README.md): native and typescript documentation

## maintainer and licence

ket is maintained by Abedalaziz Alzweidi. released under apache-2.0; see [`LICENSE`](./LICENSE), [`NOTICE`](./NOTICE), and [`CONTRIBUTING.md`](./CONTRIBUTING.md).
