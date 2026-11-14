# compiler and backends

The frontend tokenises Ket source, resolves names and qubit lifetimes, and lowers the selected circuit into primitive gates, measurements and forward conditional jumps. A compiled program owns its storage. The public C API exposes an opaque handle. [Frontend](../../native/src/frontend.c) · [Public C interface](../../native/include/ket.h)

The circuit validator checks operand indices, register widths, single assignment and conditional ranges before a backend can use them. The simulator caches the unitary prefix, samples terminal measurements directly or executes the remaining gates after each measurement. Both sampling paths pack bits in classical binding order. [Validation](../../native/src/ir.c) · [Simulator](../../native/src/simulator.c)

The OpenQASM 2 exporter writes logical gates and classical registers. The IBM backend obtains the device's basis and coupling map, lowers the circuit into physical OpenQASM 3, submits it to Sampler V2, and decodes each shot. [OpenQASM exporter](../../native/src/qasm.c) · [Hardware gates and routing](../../native/src/device.c) · [IBM client](../../native/src/ibm.c)

The browser worker runs a WebAssembly build of the C frontend, validator, simulator and exporter. JavaScript passes the entered source to the module and displays its diagnostics, gate list, assembly and counts. The same example files are copied into the static site. [Browser interface](../../native/src/web.c) · [Playground](../../playground)
