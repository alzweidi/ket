# language overview

## file structure

ket source files are plain utf-8 text. line comments start with `//`.

a file can contain:

- top-level quantum and classical declarations
- gate definitions with `gate`
- circuit definitions with `circuit`
- a `run` statement that selects the entry circuit and optional arguments

## values and declarations

single values:

```ket
qubit q
bit c
```

registers:

```ket
qubit q[3]
bit c[3]
```

register sizes must be at least `2`.

## built-in gates

single-qubit gates:

- `H`
- `X`
- `Y`
- `Z`
- `S`
- `T`

parameterised gates:

- `Rx(angle)`
- `Ry(angle)`
- `Rz(angle)`

multi-qubit gates:

- `CNOT`
- `CZ`
- `SWAP`
- `Toffoli`

## algorithms and helpers

ket also supports a few higher-level operations:

- `diffuse q`
- `grover_diffuse q`
- `qft q`
- `phase_oracle q matches |101⟩`
- `phase_oracle q matches target`

the `phase_oracle` target must be a quantum register, and the matched bitstring length must match the register size.

## measurement and control flow

measurements bind classical results:

```ket
let r = measure q
let a = measure q[0]
```

control flow uses measured classical values:

```ket
if r == |101⟩ {
  X q[0]
}

repeat floor(π / 4 * sqrt(8)) {
  H q[0]
}
```

## definitions and entry points

user-defined gates take qubit parameters:

```ket
gate bell(a, b) {
  H a
  CNOT a, b
}
```

circuits can take `angle` and `bitstring` parameters:

```ket
circuit grover(target: bitstring) {
  qubit q[3]
  repeat 2 {
    phase_oracle q matches target
    diffuse q
  }
  let r = measure q
}

run grover(|101⟩)
```

the parser also accepts `run bell() on ibm`. the cli honours that source-level backend unless you override it with `--backend`.

## angle expressions

angle expressions support:

- integers and floats
- `π`
- identifiers bound to `angle` parameters
- `+`, `-`, `*`, and `/`
- `sqrt(...)`, `floor(...)`, and `ceil(...)`

## current limitations

- declarations inside `if` and `repeat` blocks are rejected
- measured qubits cannot be used for later quantum operations
- user-defined gates expect indexed qubit arguments rather than whole registers
- run-time circuit arguments currently support `angle` and `bitstring` parameters only
- the interpreter uses the first `run` statement it finds as the entry point
