# first circuit

A Ket file can contain an inline circuit or select a named circuit with `run`.

```ket
circuit bell() {
  qubit q[2]
  H q[0]
  CNOT q[0], q[1]
  let pair = measure q
}
run bell()
```

`qubit q[2]` starts two qubits in the state `|00⟩`. The Hadamard gate puts the first qubit into superposition. CNOT flips the second qubit when the first is one. Measuring the pair gives either `00` or `11`.

Measurement consumes the qubits it reads. Its named result can control gates on other qubits. The teleportation example uses two classical results to correct a third qubit. [Teleportation circuit](../../examples/teleportation.ket)

For register rules, custom gates, angles, loops, quantum algorithms and limits, see the [language reference](../native.md#language).
