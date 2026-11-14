# using ket

Run the commands below from the repository root after `make`.

| Command | Result |
| --- | --- |
| `./build/ket check FILE` | Check a circuit and show its size |
| `./build/ket run FILE --shots 4096 --seed 42` | Sample the local simulator reproducibly |
| `./build/ket inspect FILE --json` | Read the complex amplitudes before terminal measurements |
| `./build/ket compile FILE -o circuit.qasm` | Write OpenQASM 2 |
| `./build/ket viz FILE` | Open the circuit in the playground |
| `./build/ket viz FILE --url` | Print a share link |
| `./build/ket --help` | List available commands |

Use `-` for standard input. `run` also accepts `--json`. Local measurements include their seed. Hardware results include the backend and the CLI prints the IBM job ID to standard error when submission succeeds.

## playground

`make serve` starts the static site on [localhost](http://127.0.0.1:8417). Edit a circuit, choose the shot count and press **Run**. **Compile** opens the OpenQASM export. The circuit view lists each lowered gate and its source line. **Stop** cancels an active computation. **Share** copies a link containing the source.

For a local `viz` link, set `KET_PLAYGROUND_URL=http://127.0.0.1:8417/`. Its default is the project's public playground address. The static site has no credentials or hardware endpoint. Run hardware jobs in the terminal.

## ibm quantum

Use the API key, instance CRN and backend name from the IBM Quantum Platform dashboard. The CRN identifies the service instance and region. An old `hub/group/project` identifier must be replaced with the instance CRN. [IBM authentication and instances](https://quantum.cloud.ibm.com/docs/en/api/qiskit-runtime-rest)

Set `IBM_QUANTUM_TOKEN`, `IBM_QUANTUM_INSTANCE` and `IBM_QUANTUM_BACKEND` in your environment or local `.env`. There is a template at [the repository root](../../.env.example). Environment variables take precedence over `.env`, followed by the saved `~/.ket/config`.

```sh
./build/ket run examples/bell-state.ket --backend ibm --shots 128
```

This submits a Sampler V2 job to the selected device and uses the account’s hardware allocation. Ket exchanges the key for an IAM token, requests the device configuration, compiles physical OpenQASM 3 and polls for per-shot measurements. It joins the registers from each individual shot in Ket declaration order. Keep the printed job ID if the five-minute terminal wait expires. The job remains accessible in the IBM dashboard. [IBM Sampler REST guide](https://quantum.cloud.ibm.com/docs/en/ibm-quantum-compute/sampler-rest-api)

Alternatively, `./build/ket auth` saves the three environment values in a private configuration file. It also accepts `--ibm KEY --instance CRN --backend NAME`. A source-level `run circuit_name() on ibm` selects the same hardware path. `--backend local` overrides the source selection. Local simulation supports `--seed`.

The hardware emitter requires `rz`, `sx`, `x` and connections supporting `cz`, `cx` or `ecr` for multi-qubit circuits. It uses a connected layout and restores it after routed gates. Nested classical conditions are rejected before submission. Device availability, dynamic-circuit support and account permissions are determined by IBM.
