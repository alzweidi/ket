# native ket

the c17 implementation lives in [`native`](../native). it keeps ket focused on quantum circuits: source programs become a checked list of primitive quantum operations and classical conditions. the simulator and openqasm exporter consume that same list.

the terminal, browser and hardware client share the c frontend and its checked circuit.

## build

```sh
make
make test
make sanitise
```

the build uses a c17 compiler with `<complex.h>`, the system maths library, make, pkg-config, libcurl and json-c. clang and gcc on macos/linux are the intended targets. the test driver needs python 3 with no additional packages; `make sanitise` needs clang. the executable itself needs neither node nor python.

build options can be supplied to make, for example `make CC=clang BUILD=build/clang`. generated files stay under `build/`, which is ignored by git.

## commands

| command | result |
| --- | --- |
| `./build/ket check FILE` | parse, resolve, and expand the selected circuit; print its size |
| `./build/ket run FILE --shots 4096 --seed 42` | sample local measurement results |
| `./build/ket inspect FILE` | inspect amplitudes before terminal measurements |
| `./build/ket compile FILE -o circuit.qasm` | export openqasm 2.0 |

`run` and `inspect` accept `--json`. source path `-` reads stdin. `compile` writes stdout unless given `-o FILE`; `-o -` also means stdout. source and output cannot be the same file, including existing symbolic or hard links. export errors are checked before an existing output file is opened.

`run` defaults to 1,024 shots and a seed derived from the current time. the chosen seed is printed. `--seed` accepts any unsigned 64-bit integer, including zero. repeatability means the same executable, source, options, and seed; floating-point differences across platforms or future sampling changes can change individual draws.

successful commands return 0, source/runtime/file errors return 1, and invalid command-line arguments return 2. compiler errors include the source path, line, column, and a caret when the line fits on screen.

`run ... on ibm` selects IBM Quantum. The CLI also accepts `--backend local|ibm`. See [IBM configuration and playground commands](usage/cli.md).

## language

source uses ascii identifiers, decimal numbers with optional exponents, `//` comments, and optional semicolons. both `pi` and `π` are accepted; both `|101>` and `|101⟩` denote a bitstring.

a program either contains executable top-level statements or selects one named circuit with `run`. combining the two is an error, as are multiple run statements. forward references to gate and circuit definitions are allowed. the whole file is parsed, but semantic resolution and expansion apply to the selected entry point and reachable gate bodies. an unused definition is not a guarantee of semantic validity.

```ket
circuit search(target: bitstring, turns: angle) {
  qubit q[4]
  H q
  repeat turns {
    phase_oracle q matches target
    diffuse q
  }
  let result = measure q
}

run search(|1010>, 3)
```

### declarations and gates

`qubit q` declares one qubit; `qubit q[4]` declares a contiguous register. all qubits start in zero. declarations are allowed at circuit/top level only. names cannot shadow another binding, a definition, or a reserved word.

single-qubit operations broadcast over a register. multi-qubit gates and custom gates require distinct individual qubits, such as `CNOT q[0], q[1]`.

| operations | arguments |
| --- | --- |
| `H`, `X`, `Y`, `Z`, `S`, `T` | one qubit or register |
| `Rx(angle)`, `Ry(angle)`, `Rz(angle)` | one qubit or register; angle in radians |
| `CNOT`, `CZ`, `SWAP` | two distinct individual qubits |
| `Toffoli` | two controls, then one target |
| `qft`, `diffuse`, `grover_diffuse` | one qubit or contiguous register |
| `phase_oracle q matches target` | quantum operand and an equally wide bitstring |

custom gates take only individual qubit parameters and expand inline. their bodies must be unitary: they cannot measure, declare qubits, or branch on classical results. recursive gate expansion is rejected.

circuits accept `angle` and `bitstring` parameters. angle expressions support `+`, `-`, `*`, `/`, unary signs, parentheses, `sqrt`, `floor`, and `ceil`. values must be finite. a repeat count is a compile-time integer from 0 to 10,000. even a zero-repeat body is checked before its operations are discarded.

`bit c` and `bit c[4]` are accepted for source compatibility, but there is no assignment operation for them. use `let name = measure ...` to create a value that can control a circuit.

### measurements and control

measurement binds an immutable classical value and consumes the selected qubits. later gates or measurements on those qubits are errors. other elements of the same register remain usable.

```ket
qubit q[2]
H q[0]
let choice = measure q[0]
if choice == |1> {
  X q[1]
}
let result = measure q[1]
```

measurement bindings must be at circuit/top level, outside `repeat`, `if`, and gate bodies. an `if` compares a previously measured value against a whole bitstring or non-negative integer. the widths/range must match. nested conditions work in the simulator; openqasm 2 export rejects them because its condition syntax cannot represent arbitrary conjunctions.

if there are no explicit measurements, ket adds one terminal measurement of all qubits named `result`. if any explicit measurements exist, only those bindings appear in counts; unused qubits are not appended automatically.

`inspect` requires every measurement to be terminal: there must be no quantum operation or condition after the first measurement. it reports the state immediately before those measurements. use `run` for circuits with classical feed-forward, such as [teleportation](../examples/teleportation.ket).

### bit and phase conventions

qubits are ordered by declaration, with register elements in ascending index order. the first qubit is the most significant, leftmost bit. `X q[0]` on a three-qubit register prepares `|100>`.

counts concatenate measurement bindings in source order. within each binding, the first selected qubit is the most significant bit. json output includes each binding's name and width. measuring `q[2]` before `q[0]` therefore prints those results in that order.

openqasm numbers classical bits from the least significant bit. the exporter reverses the destination indices within each measurement register so ket's integer conditions have the same meaning. external tools may display the registers in a different order; use the `m0`, `m1`, etc. mapping in the export.

the qft on an n-qubit register implements `|x> → sum_y exp(2πi xy / 2^n)|y> / sqrt(2^n)`, including the final swaps. it uses controlled phase, which differs from a controlled z rotation. diffusion is exactly `2|s><s| - I`, where `|s>` is the uniform superposition. the phase oracle negates only the marked computational basis state. these conventions also apply to exported gates.

openqasm 2 consumers can interpret gate definitions with different global phases, notably `rz`. ket uses the rotation convention also used by qiskit's default importer; an external tool's amplitudes may differ by a global phase while measurement probabilities agree. see [ibm's phase-convention notes](https://quantum.cloud.ibm.com/docs/en/api/qiskit/2.3/qasm2#openqasm-2-phase-conventions).

`inspect` prints only entries with probability at least `1e-14`; omitted entries are negligible, not necessarily exactly zero. probabilities are computed from amplitudes, whereas `run` reports empirical counts. both calculations use double precision.

## implementation

| file | responsibility |
| --- | --- |
| [`frontend.c`](../native/src/frontend.c) | lexer, expression/statement parser, bindings, semantic checks, specialisation and lowering |
| [`ket.h`](../native/include/ket.h) | opaque program handle, source spans, diagnostics and public c interface |
| [`simulator.c`](../native/src/simulator.c) | state vector, unitary gates, collapse, classical branching, and seeded sampling |
| [`qasm.c`](../native/src/qasm.c) | primitive operations to openqasm 2.0 with `qelib1.inc` |
| [`main.c`](../native/src/main.c) | file handling, arguments, and text/json output |

the compiler resolves all qubit indices and numeric arguments before a backend runs. qft, oracles, diffusion, custom gates, and repeats become ordinary primitive operations. a backend never independently reconstructs these algorithms. larger controlled phases use an exact parity-phase decomposition; expansion can be exponential, so it has an explicit limit.

terminal measurements sample a cumulative probability distribution built once. circuits with feed-forward cache the unitary prefix, then collapse and execute the conditional suffix independently for each shot. randomness belongs to each run; there is no process-global random state.

`ket_compile` returns a program that owns its storage. the caller may release the source after compilation. pass that program to `ket_inspect`, `ket_run`, or `ket_qasm`; release returned state/results/programs with the matching free functions in `ket.h`. `ket_program_info` returns circuit sizes and the selected backend. `ket_measurement_name` returns a binding name and width in the order used for results. the public program handle is opaque. each backend validates the private representation before using register indices or conditional jumps. source/error/output pointers must be valid; source must be nul-terminated. the command-line reader additionally rejects embedded nul bytes.

## limits

| resource | limit |
| --- | --- |
| source file | 1 mib |
| identifier | 63 ascii bytes |
| qubits and measured bits | 20 total |
| oracle/diffusion operand | 10 qubits |
| expanded operations | 100,000, including measurements and conditions |
| repeat count | 10,000 per loop |
| parser, expression evaluation, and expansion depth | 64 recursive levels |
| compiler temporary allocations | 64 mib, plus the operation array |
| expansion work | 1,000,000 statement/block visits |
| shots | 1 through 1,000,000 |

nesting limits count internal parser/evaluator frames, not just visible braces. a state vector uses roughly 16 mib at 20 qubits; sampling and feed-forward require additional buffers. mid-circuit measurements can still be expensive because their suffix runs for each shot. these limits bound resources; they do not promise fast execution for every accepted circuit.

the local simulator models ideal, noiseless gates. ket programs compile to quantum circuits. the terminal and playground export openqasm 2. the ibm client emits physical openqasm 3 for the selected device.

## validation

[`test_native.py`](../native/tests/test_native.py) exercises the executable with only the python standard library. expected results come from bell states, interference identities, the analytic fourier transform, grover's success formula, diffusion's matrix definition, and teleportation followed by inverse state preparation.

export tests interpret primitive gates with an independent dense-matrix evaluator. that evaluator is a narrow test oracle, not a general openqasm parser. tests also cover partial measurements, feed-forward branches, seed reproducibility, the existing examples and fixtures, bounded expansion, malformed input, and output-file preservation.

`make sanitise` runs the same suite under clang's address and undefined-behaviour sanitisers, with undefined behaviour configured to fail the command. ci also rebuilds the webassembly module and checks the shipped browser engine against the cli.
