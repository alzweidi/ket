"""cli tests against analytic states and independent matrix calculations."""
import cmath
import json
import math
from pathlib import Path
import random
import re
import subprocess
import sys
import tempfile
import unittest

BINARY = Path(sys.argv.pop(1)).resolve()
ROOT = Path(__file__).resolve().parents[2]


def invoke(command, source, *options):
    return subprocess.run([str(BINARY), command, "-", *options], input=source,
                          text=True, capture_output=True, timeout=15)


def reference_qasm(text):
    """evaluate unitary exports on small dense vectors, before measurements.

    this only parses the emitted gate subset. each gate acts on every basis
    column, independently of the native simulator's paired-amplitude updates.
    """
    n = int(re.search(r"qreg q\[(\d+)\]", text)[1])
    state = [1+0j] + [0j] * (2**n-1)
    h = 1 / math.sqrt(2)
    matrices = {
        "h": [[h, h], [h, -h]], "x": [[0, 1], [1, 0]],
        "y": [[0, -1j], [1j, 0]], "z": [[1, 0], [0, -1]],
        "s": [[1, 0], [0, 1j]], "t": [[1, 0], [0, cmath.exp(1j*math.pi/4)]],
        "cx": [[1,0,0,0],[0,1,0,0],[0,0,0,1],[0,0,1,0]],
        "cz": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,-1]],
    }
    for raw in text.splitlines():
        line = raw.split("//")[0].strip()
        if not line or line.startswith(("OPENQASM", "include", "qreg", "creg", "measure")):
            continue
        match = re.fullmatch(r"([a-z0-9]+)(?:\(([^)]+)\))? (q\[\d+\](?:,q\[\d+\]){0,2});", line)
        if not match:
            raise AssertionError(f"unrecognised exported instruction: {line}")
        name, angle, operands = match.groups()
        qs = [int(q) for q in re.findall(r"\d+", operands)]
        dim = 2**len(qs)
        if name in ("rx", "ry", "rz", "u1", "cu1"):
            t = float(angle)
            c, s = math.cos(t/2), math.sin(t/2)
            if name == "rx": matrix = [[c, -1j*s], [-1j*s, c]]
            elif name == "ry": matrix = [[c, -s], [s, c]]
            elif name == "rz": matrix = [[cmath.exp(-1j*t/2), 0], [0, cmath.exp(1j*t/2)]]
            elif name == "u1": matrix = [[1, 0], [0, cmath.exp(1j*t)]]
            else: matrix = [[(cmath.exp(1j*t) if i == 3 else 1) if i == j else 0 for j in range(4)] for i in range(4)]
        elif name == "ccx":
            matrix = [[int(i == (j ^ 1 if j >= 6 else j)) for j in range(8)] for i in range(8)]
        else:
            matrix = matrices[name]
        target_mask = sum(1 << (n-1-q) for q in qs)
        result = [0j] * len(state)
        for column, amplitude in enumerate(state):
            local_column = 0
            for q in qs:
                local_column = local_column*2 + ((column >> (n-1-q)) & 1)
            for local_row in range(dim):
                row = column & ~target_mask
                for i, q in enumerate(qs):
                    row |= ((local_row >> (len(qs)-1-i)) & 1) << (n-1-q)
                result[row] += matrix[local_row][local_column] * amplitude
        state = result
    return state


class NativeKet(unittest.TestCase):
    def good(self, command, source, *options):
        result = invoke(command, source, *options)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return result.stdout

    def state(self, source):
        data = json.loads(self.good("inspect", source, "--json"))
        amplitudes = [0j] * (2**data["qubits"])
        for row in data["amplitudes"]:
            amplitudes[int(row["basis"], 2)] = complex(row["real"], row["imaginary"])
        self.assertAlmostEqual(sum(abs(a)**2 for a in amplitudes), 1, places=10)
        return amplitudes

    def assert_state(self, actual, expected):
        self.assertEqual(len(actual), len(expected))
        for index, (a, b) in enumerate(zip(actual, expected)):
            self.assertLess(abs(a-b), 2e-10, f"amplitude {index}: {a} != {b}")

    def counts(self, source, shots=1024, seed=42):
        return json.loads(self.good("run", source, "--shots", str(shots), "--seed", str(seed), "--json"))["counts"]

    def test_existing_examples_and_valid_fixtures(self):
        paths = sorted((ROOT / "examples").glob("*.ket")) + sorted((ROOT / "tests/fixtures/valid").glob("*.ket"))
        for path in paths:
            with self.subTest(path=path.name):
                source = path.read_text()
                self.good("check", source)
                counts = self.counts(source, 16)
                self.assertEqual(sum(counts.values()), 16)
                if path.name == "teleportation.ket":
                    self.assertTrue(all(bits.endswith("0") for bits in counts))
                self.assertTrue(self.good("compile", source).startswith("OPENQASM 2.0;"))

    def test_existing_invalid_fixtures(self):
        for path in (ROOT / "tests/fixtures/invalid").glob("*.ket"):
            with self.subTest(path=path.name):
                result = invoke("check", path.read_text())
                self.assertEqual(result.returncode, 1)
                self.assertIn("error:", result.stderr)

    def test_bell_amplitudes_and_reproducible_sampling(self):
        source = "qubit q[2]\nH q[0]\nCNOT q[0], q[1]\nlet r = measure q"
        h = 1/math.sqrt(2)
        self.assert_state(self.state(source), [h, 0, 0, h])
        first = self.counts(source, 4096, 0)
        self.assertEqual(first, self.counts(source, 4096, 0))
        self.assertEqual(set(first), {"00", "11"})
        self.assertLess(abs(first["00"]/4096 - .5), .03)
        self.assertNotEqual(first, self.counts(source, 4096, 1))

    def test_interference_and_rotations(self):
        self.assert_state(self.state("qubit q H q H q"), [1,0])
        self.assert_state(self.state("qubit q H q Z q H q"), [0,1])
        self.assert_state(self.state("qubit q Y q"), [0,1j])
        self.assert_state(self.state("qubit q Rx(pi) q"), [0,-1j])
        self.assert_state(self.state("qubit q Ry(π) q"), [0,1])
        self.assert_state(self.state("qubit q Rz(pi) q"), [-1j,0])

    def test_bit_order_and_multiple_measurements(self):
        source = "qubit q[3] X q[0] X q[2] let a = measure q[2] let b = measure q[0] let c = measure q[1]"
        self.assertEqual(self.counts(source, 32), {"110":32})
        self.assertEqual(self.counts("qubit q[3] X q[0]", 16), {"100":16})
        qasm = self.good("compile", "qubit q[3] X q[0] let a = measure q if a == |100> {}")
        self.assertIn("measure q[0] -> m0[2];", qasm)
        self.assertIn("measure q[2] -> m0[0];", qasm)

    def test_qft_matches_analytic_dft_for_every_basis_state(self):
        for n in range(1,5):
            dim = 2**n
            for basis in range(dim):
                with self.subTest(qubits=n, basis=basis):
                    prep = " ".join(f"X q[{i}]" for i in range(n) if basis & (1 << (n-1-i)))
                    source = f"qubit q[{n}] {prep} qft q"
                    expected = [cmath.exp(2j*math.pi*basis*k/dim)/math.sqrt(dim) for k in range(dim)]
                    self.assert_state(self.state(source), expected)

    def test_oracle_marks_exactly_the_requested_basis_state(self):
        for n in range(1,7):
            target = (2**n)//3
            bits = f"{target:0{n}b}"
            source = f"qubit q[{n}] H q phase_oracle q matches |{bits}>"
            expected = [(-1 if i == target else 1)/math.sqrt(2**n) for i in range(2**n)]
            self.assert_state(self.state(source), expected)
            self.assert_state(reference_qasm(self.good("compile", source)), expected)

    def test_diffusion_matches_matrix_definition(self):
        for n in range(1,6):
            source = f"qubit q[{n}] Ry(.73) q[0] H q[{n-1}]"
            initial = self.state(source)
            mean = sum(initial) / len(initial)
            expected = [2*mean-a for a in initial]
            self.assert_state(self.state(source + " diffuse q"), expected)

    def test_grover_success_matches_analytic_probability(self):
        for n, repeats in [(3,2),(4,3),(5,4)]:
            target = "10" + "1"*(n-2)
            source = f"qubit q[{n}] H q repeat {repeats} {{ phase_oracle q matches |{target}> diffuse q }}"
            actual = abs(self.state(source)[int(target,2)])**2
            expected = math.sin((2*repeats+1)*math.asin(1/math.sqrt(2**n)))**2
            self.assertAlmostEqual(actual, expected, places=10)

    def test_subregister_oracle_preserves_spectator(self):
        source = "qubit spectator H spectator qubit q[4] H q phase_oracle q matches |1010>"
        expected = [(-1 if i % 16 == 10 else 1)/math.sqrt(32) for i in range(32)]
        self.assert_state(self.state(source), expected)

    def test_custom_gate_aliases_and_forward_definitions(self):
        source = "gate outer(a,b) { inner b,a } gate inner(x,y) { H x CNOT x,y } circuit c() { qubit q[2] outer q[1],q[0] } run c()"
        h = 1/math.sqrt(2)
        self.assert_state(self.state(source), [h,0,0,h])

    def test_repeated_custom_gate_reuses_compiler_storage(self):
        source = "gate flip(a) { X a } qubit q repeat 10000 { flip q }"
        self.assert_state(self.state(source), [1,0])

    def test_terminal_measurement_sampling_at_qubit_limit(self):
        source = "qubit q[20] H q[0] CNOT q[0],q[19] let last = measure q[19] let first = measure q[0]"
        counts = self.counts(source, 100000, 0)
        self.assertEqual(set(counts), {"00","11"})
        self.assertEqual(sum(counts.values()), 100000)
        self.assertLess(abs(counts["00"]/100000 - .5), .01)

    def test_partial_measurement_marginal_and_dynamic_branch_skipping(self):
        # the unmeasured first qubit must be marginalised out of the counts.
        counts = self.counts("qubit q[2] H q[0] Ry(pi/3) q[1] let r = measure q[1]", 20000)
        self.assertLess(abs(counts["1"]/20000 - .25), .015)
        source = """qubit q[3]
            let a = measure q[0]
            if a == 1 { X q[1] if a == 0 { X q[2] } }
            if a == 0 { X q[1] }
            let r = measure q[1]
            let s = measure q[2]"""
        self.assertEqual(self.counts(source, 64), {"010":64})

    def test_parameters_expressions_unicode_and_comments(self):
        source = "// π\r\ncircuit c(t: angle, mark: bitstring) { qubit q[2]; repeat floor(sqrt(4)) { H q[0] } Ry(-(-t)+ceil(0)) q[1] phase_oracle q matches mark } run c(π, |01⟩)"
        self.assert_state(self.state(source), [0,-1,0,0])

    def test_classical_feed_forward_teleportation(self):
        for theta, phi in [(0,0),(.7,1.1),(2.2,-.4),(math.pi,0)]:
            source = f"""qubit q[3]
                Ry({theta}) q[0] Rz({phi}) q[0]
                H q[1] CNOT q[1],q[2]
                CNOT q[0],q[1] H q[0]
                let c = measure q[0] let d = measure q[1]
                if d == 1 {{ X q[2] }}
                if c == |1> {{ Z q[2] }}
                Rz(-({phi})) q[2] Ry(-({theta})) q[2]
                let result = measure q[2]"""
            counts = self.counts(source, 256)
            self.assertEqual(set(counts), {"000","010","100","110"})
            result = invoke("inspect", source)
            self.assertEqual(result.returncode, 1)
            self.assertIn("terminal measurements", result.stderr)
            qasm = self.good("compile", source)
            self.assertIn("if(m1==1) x q[2];", qasm)
            self.assertIn("if(m0==1) z q[2];", qasm)

    def test_nested_conditions_run_and_export_is_honest(self):
        source = "qubit q[3] X q[0] X q[1] let a = measure q[0] let b = measure q[1] if a == 1 { if b == 1 { X q[2] } } let r = measure q[2]"
        self.assertEqual(self.counts(source, 16), {"111":16})
        result = invoke("compile", source)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("nested classical conditions", result.stderr)

    def test_unitary_export_agrees_with_native_on_mixed_circuits(self):
        rng = random.Random(17)
        for _ in range(12):
            lines = ["qubit q[4]"]
            for _ in range(18):
                a,b,c = rng.sample(range(4),3)
                lines.append(rng.choice([f"H q[{a}]", f"Y q[{a}]", f"S q[{a}]", f"T q[{a}]",
                    f"Rx({rng.uniform(-3,3)}) q[{a}]", f"Ry({rng.uniform(-3,3)}) q[{a}]",
                    f"Rz({rng.uniform(-3,3)}) q[{a}]", f"CNOT q[{a}],q[{b}]",
                    f"CZ q[{a}],q[{b}]", f"SWAP q[{a}],q[{b}]", f"Toffoli q[{a}],q[{b}],q[{c}]"]))
            lines += ["qft q", "phase_oracle q matches |1010>", "diffuse q"]
            source = "\n".join(lines)
            self.assert_state(self.state(source), reference_qasm(self.good("compile", source)))

    def test_openqasm_real_literals_and_conditional_swap(self):
        for angle in (1e20, -1e-100, 0.0):
            qasm = self.good("compile", f"qubit q Rz({angle}) q")
            literal = re.search(r"rz\(([^)]+)\)", qasm)[1]
            self.assertRegex(literal, r"^-?\d+\.\d+(?:e[+-]?\d+)?$")
            self.assertEqual(float(literal), angle)

        source = """qubit q[3] X q[0] X q[1] let control = measure q[0]
                    if control == 1 { SWAP q[1],q[2] } let result = measure q[2]"""
        gates = [line for line in self.good("compile", source).splitlines() if "cx " in line]
        self.assertEqual(gates, ["if(m0==1) cx q[1],q[2];",
                                 "if(m0==1) cx q[2],q[1];",
                                 "if(m0==1) cx q[1],q[2];"])

    def test_semantic_and_syntax_errors_have_source_locations(self):
        cases = [
            ("qubit q H missing", "not a declared qubit"),
            ("qubit q[0]", "positive"),
            ("qubit q[21]", "register size"),
            ("qubit q[20] qubit x", "20 qubits"),
            ("qubit q qubit q", "already declared"),
            ("qubit H", "reserved"),
            ("qubit q[2] X q[2]", "outside"),
            ("qubit q[2] CNOT q[0],q[0]", "distinct"),
            ("qubit q[2] CNOT q,q[0]", "individual qubits"),
            ("qubit q[2] CNOT q[0]", "expects 2"),
            ("qubit q X(pi) q", "does not take an angle"),
            ("qubit q Rx q", "requires an angle"),
            ("qubit q Rx(1/0) q", "not finite"),
            ("qubit q Rx(sqrt(-1)) q", "not finite"),
            ("qubit q Rx(1e999) q", "finite range"),
            ("qubit q Rx(12abc) q", "malformed"),
            ("qubit q Rx(0x1p2) q", "malformed"),
            ("qubit q Rx(1e+) q", "malformed"),
            ("qubit q repeat -1 { X q }", "repeat count"),
            ("qubit q repeat 1.5 { X q }", "repeat count"),
            ("qubit q repeat 0 { X missing }", "not a declared qubit"),
            ("qubit q repeat 2 { qubit other }", "circuit/top level"),
            ("qubit q repeat 2 { let r = measure q }", "measurement bindings"),
            ("qubit q let r = measure q H q", "already been measured"),
            ("qubit q let r = measure q let s = measure q", "already been measured"),
            ("qubit q if q == 1 {}", "previous measurement"),
            ("qubit q let r = measure q if r == |00> {}", "width"),
            ("qubit q let r = measure q if r == 2 {}", "condition value"),
            ("qubit q[2] phase_oracle q matches |1>", "width"),
            ("qubit q[2] phase_oracle q matches |102>", "binary digits"),
            ("qubit q[11] diffuse q", "limited to 10 qubits"),
            ("qubit q mystery q", "unknown gate"),
            ("gate recurse(a) { recurse a } qubit q recurse q", "recursive"),
            ("gate g(a,b) { CNOT a,b } qubit q g q,q", "distinct"),
            ("gate g(a) { let r = measure a } qubit q g q", "measurement bindings"),
            ("circuit c() { qubit q } run c() run c()", "at most one run"),
            ("circuit c() { qubit q } qubit q run c()", "cannot be combined"),
            ("circuit c() { qubit q } run missing()", "unknown circuit"),
            ("circuit c(t: angle) { qubit q } run c(|0>)", "type angle"),
            ("circuit c(t: bitstring) { qubit q } run c(1)", "type bitstring"),
            ("circuit c(t: angle) { qubit q } run c()", "expects 1 arguments"),
            ("circuit c(t: qubit) { qubit q } run c(1)", "angle or bitstring"),
            ("circuit c(t: angle,t: angle) { qubit q }", "duplicate parameter"),
            ("circuit c() { qubit q", "expected '}'"),
            ("circuit c() { qubit q }", "no executable circuit"),
            ("qubit " + "x"*64, "63 bytes"),
            ("qubit q @", "unexpected character"),
        ]
        for source, message in cases:
            with self.subTest(source=source):
                result = invoke("check", source)
                self.assertEqual(result.returncode, 1, result.stdout)
                self.assertIn(message, result.stderr)
                self.assertRegex(result.stderr, r"-:\d+:\d+: error:")

    def test_resource_limits_terminate_cleanly(self):
        sources = [
            "qubit q Rx(" + "("*100 + "0" + ")"*100 + ") q",
            "qubit q repeat 10000 { repeat 10000 {} }",
            "qubit q repeat 1000 { repeat 1000 { X q } }",
            "qubit q Rx(" + "+".join(["1"]*500) + ") q",
        ]
        for source in sources:
            with self.subTest(source=source[:60]):
                result = invoke("check", source)
                self.assertEqual(result.returncode, 1)
                self.assertIn("error:", result.stderr)

    def test_malformed_input_never_crashes(self):
        rng = random.Random(114)
        alphabet = "qubitXYZ012[]{}()/,;|>π⟩=+-*\n \t\r"
        for _ in range(80):
            source = "".join(rng.choices(alphabet, k=rng.randint(1,150)))
            result = invoke("check", source)
            self.assertIn(result.returncode, (0,1), result.stderr)
            self.assertNotIn("Sanitizer", result.stderr)

    def test_cli_rejects_invalid_flags_and_remote_execution(self):
        for options in [("--shots","0"),("--shots","-1"),("--shots","1.5"),
                        ("--shots","1000001"),("--seed","18446744073709551616"),
                        ("--seed",),("--unknown",)]:
            result = invoke("run", "qubit q", *options)
            self.assertEqual(result.returncode, 2)
        result = invoke("run", "circuit c() { qubit q } run c() on ibm")
        self.assertEqual(result.returncode, 1)
        self.assertIn("remote execution", result.stderr)
        result = invoke("check", "qubit q\x00X q")
        self.assertEqual(result.returncode, 1)
        self.assertIn("NUL", result.stderr)

    def test_export_failure_does_not_destroy_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)/"output.qasm"
            out.write_text("keep me")
            result = invoke("compile", "qubit q X missing", "-o", str(out))
            self.assertEqual(result.returncode, 1)
            self.assertEqual(out.read_text(), "keep me")
            source = "qubit q[2] let a = measure q[0] if a == 1 { if a == 1 { X q[1] } }"
            result = invoke("compile", source, "-o", str(out))
            self.assertEqual(result.returncode, 1)
            self.assertEqual(out.read_text(), "keep me")
            self.good("compile", "qubit q X q", "-o", str(out))
            self.assertIn("x q[0];", out.read_text())

    def test_output_aliases_cannot_overwrite_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/"source.ket"
            source.write_text("qubit q X q")
            alias = Path(directory)/"alias.ket"
            alias.symlink_to(source)
            hardlink = Path(directory)/"hardlink.ket"
            hardlink.hardlink_to(source)
            for output in (source, alias, hardlink):
                result = subprocess.run([str(BINARY), "compile", str(source), "-o", str(output)],
                                        text=True, capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 2)
                self.assertIn("overwrite the source", result.stderr)
                self.assertEqual(source.read_text(), "qubit q X q")
        self.assertEqual(self.good("compile", "qubit q", "-o", "-"),
                         self.good("compile", "qubit q"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
