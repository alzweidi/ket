# ket

Ket is a small quantum programming language written in C17. Write a circuit once and sample it in the terminal or playground, inspect its amplitudes, export OpenQASM, or send it to an IBM quantum computer.

```ket
qubit q[2]
H q[0]
CNOT q[0], q[1]
let pair = measure q
```

## try it

With a C compiler, Make, pkg-config, libcurl and json-c installed, run these commands from the checkout. Platform-specific packages are listed in the [installation guide](docs/getting-started/installation.md).

```sh
make
./build/ket run examples/bell-state.ket --shots 4096 --seed 42
```

The Hadamard gate and CNOT entangle the two qubits. In the ideal simulator, the only outcomes are `00` and `11`. The [Grover](examples/grover.ket), [Fourier transform](examples/qft.ket) and [teleportation](examples/teleportation.ket) examples exercise the same compiler.

```sh
./build/ket inspect examples/bell-state.ket
./build/ket compile examples/teleportation.ket
make serve
```

Open the [local playground](http://127.0.0.1:8417) after starting the server. The browser runs the C compiler and simulator as WebAssembly in a worker. The checked-in browser engine can be served as static files.

## wave packet in the terminal

```sh
make wavepacket
```

The terminal shows the Ket source and a seven-qubit particle moving along a line. The Gaussian packet strikes a barrier at sites 64–67 and splits. The plot shows the wave amplitude `|ψ(x)|`. The percentages below it are sums of `|ψ(x)|²` to the left, inside and to the right of the barrier.

The [circuit](examples/packet.ket) contains the complete state preparation and evolution. `gaussian` prepares a truncated Gaussian in momentum space. `qft x` converts it to position. Each of the 208 time steps applies the barrier phase, transforms to momentum, applies the free-particle phase and transforms back. The C viewer runs that same circuit at successive step counts and plots the state before measurement.

The calculation uses a periodic grid of 128 sites with unit spacing, mass and ℏ. Each step advances time by 0.25 and the barrier height is 0.7. Use a terminal at least 66 columns wide and 47 rows tall. To inspect the final amplitudes directly, run `./build/ket inspect examples/packet.ket`.

## two-path interference

```sh
make fringes
```

This seven-qubit circuit sends two paths through a quantum Fourier transform onto 64 detector bins. Each frame plots shots from the C simulator. The horizontal position is the measurement and the vertical position spreads overlapping hits for display. A marker qubit records the path in the second run. The interference pattern returns in the third run with the marker switched off. Use a terminal at least 64 columns wide and 42 rows tall. [Circuit source](examples/fringes.ket)

## hardware

The CLI uses IBM Cloud IAM and Sampler V2. Set an IBM Cloud API key, instance CRN and device name, then choose `--backend ibm` or write `on ibm` in the program. Ket routes the checked circuit onto the device’s connections and submits a hardware job. [IBM configuration and commands](docs/usage/cli.md#ibm-quantum)

## language and tests

The simulator supports 20 qubits, mid-circuit measurements, classical feed-forward, custom gates, rotations, QFT, phase oracles and Grover diffusion. The [language and C API reference](docs/native.md) records the gate conventions and limits.

```sh
make test
make sanitise
make test-web
```

The native tests include an isolated IBM service with dummy credentials. The browser parity test compares the shipped WebAssembly with the C executable. [Build and test instructions](CONTRIBUTING.md)

Maintained by Abedalaziz Alzweidi. [Apache 2.0 licence](LICENSE) · [Notice](NOTICE)
