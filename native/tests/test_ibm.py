"""exercise the native ibm client against an isolated loopback service."""
import base64
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlsplit

from test_native import reference_qasm

BINARY = Path(sys.argv[1]).resolve() if __name__ == "__main__" else None
INSTANCE = "crn:v1:bluemix:public:quantum-computing:us-east:a/test:instance::"
BELL = "qubit q[2] H q[0] CNOT q[0],q[1] let r = measure q"
SPLIT = "qubit q[3] X q[0] let a = measure q[0] let b = measure q[2]"

class Exchange:
    def __init__(self, gate="cz"):
        self.device = {"n_qubits": 4, "basis_gates": ["rz", "sx", "x", gate],
                       "coupling_map": [[0, 1], [1, 2], [2, 3]], "gates": []}
        self.status = ["Completed"]
        self.data = {"m0": {"samples": ["0x0", "0x3", "0x0", "0x3"]}}
        self.key = "test+key&only"
        self.device_name = "ibm_test"
        self.calls = []
        self.jobs = []
        self.iam_error = False
        self.limited = False
        self.status_error = False

    def respond(self, method, path, headers, body):
        self.calls.append((method, path))
        if path == "/iam" and method == "POST":
            form = parse_qs(body.decode())
            if self.iam_error or form != {"apikey": [self.key], "grant_type": ["urn:ibm:params:oauth:grant-type:apikey"]}:
                return 401, {"message": "invalid API key"}
            return 200, {"access_token": "fixture-bearer"}
        required = {"Authorization": "Bearer fixture-bearer", "Service-CRN": INSTANCE, "IBM-API-Version": "2026-04-15"}
        if any(headers.get(k) != v for k, v in required.items()):
            return 403, {"message": "missing IBM headers"}
        if path == f"/api/v1/backends/{self.device_name}/configuration" and method == "GET":
            return 200, self.device
        if path == "/api/v1/jobs" and method == "POST":
            if self.limited:
                self.limited = False
                return 429, {}
            job = json.loads(body)
            self.jobs.append(job)
            return 201, {"id": "fixture-job"}
        if path == "/api/v1/jobs/fixture-job?exclude_params=true":
            if self.status_error:
                return 503, {"errors": [{"message": "temporarily unavailable"}]}
            status = self.status.pop(0) if len(self.status) > 1 else self.status[0]
            return 200, {"state": {"status": status, "reason": "fixture"}}
        if path == "/api/v1/jobs/fixture-job/results":
            return 200, {"results": [{"data": self.data}]}
        return 404, {"message": "unknown route"}

@contextmanager
def service(exchange):
    class Handler(BaseHTTPRequestHandler):
        def dispatch(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            status, payload = exchange.respond(self.command, self.path, self.headers, body)
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        do_GET = do_POST = dispatch
        def log_message(self, *args):
            pass
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02})
        worker.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            worker.join()

class IBM(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.directory = Path(temp.name)
        self.exchange = Exchange()
        self.env = {"HOME": temp.name, "PATH": os.defpath, "IBM_QUANTUM_TOKEN": self.exchange.key,
                    "IBM_QUANTUM_INSTANCE": INSTANCE, "IBM_QUANTUM_BACKEND": self.exchange.device_name}
        for key in ("ASAN_OPTIONS", "UBSAN_OPTIONS"):
            if key in os.environ:
                self.env[key] = os.environ[key]

    def command(self, *args, source=""):
        return subprocess.run([BINARY, *args], input=source, env=self.env, cwd=self.directory,
                              text=True, capture_output=True, timeout=16)

    def run_job(self, source=BELL, *args):
        with service(self.exchange) as url:
            self.env.update(KET_TEST_IAM=url+"/iam", KET_TEST_RUNTIME=url+"/api/v1")
            return self.command("run", "-", "--shots", "4", "--json", *args, source=source)

    def test_sampler_job_and_measurement_order(self):
        self.exchange.data = {"m0": {"samples": ["0x0", "0x1", "0x1", "0x0"]},
                              "m1": {"samples": ["0x1", "0x0", "0x0", "0x1"]}}
        result = self.run_job(SPLIT, "--backend", "ibm")
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["counts"], {"01": 2, "10": 2})
        self.assertEqual(report["backend"], "ibm")
        self.assertNotIn("seed", report)
        self.assertEqual([m["name"] for m in report["measurements"]], ["a", "b"])
        job, = self.exchange.jobs
        self.assertEqual((job["backend"], job["program_id"], job["params"]["version"]), ("ibm_test", "sampler", 2))
        asm, values, shots = job["params"]["pubs"][0]
        self.assertIsNone(values)
        self.assertEqual(shots, 4)
        self.assertIn("m0[0] = measure $0;", asm)
        self.assertIn("m1[0] = measure $2;", asm)

    def test_device_basis_and_source_selects_ibm(self):
        source = "circuit bell() {" + BELL + "} run bell() on ibm"
        for gate in ("cx", "cz", "ecr"):
            with self.subTest(gate=gate):
                self.exchange = Exchange(gate)
                result = self.run_job(source)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["counts"], {"00": 2, "11": 2})
                asm = self.exchange.jobs[0]["params"]["pubs"][0][0]
                self.assertIn(f"{gate} $0,$1;", asm)
                self.assertIn("m0[1] = measure $0;", asm)
                self.assertIn("m0[0] = measure $1;", asm)

    def test_route_onto_directed_gate_connections(self):
        self.exchange.device["gates"] = [{"name": "cz", "coupling_map": [[1,0],[2,1],[3,2]]}]
        result = self.run_job("qubit q[3] CNOT q[0],q[2]", "--backend", "ibm")
        self.assertEqual(result.returncode, 0, result.stderr)
        asm = self.exchange.jobs[0]["params"]["pubs"][0][0]
        gates = [line for line in asm.splitlines() if line.startswith("cz ")]
        self.assertGreater(len(gates), 1)
        self.assertEqual(set(gates), {"cz $1,$0;", "cz $2,$1;"})

    def test_device_gates_preserve_amplitudes(self):
        source = """qubit q[3] H q[0] Ry(.52) q[1] Rx(-.91) q[2] X q[2] Y q[1] Z q[0]
                    S q[2] T q[1] Rz(.21) q[2] CNOT q[0],q[2] CZ q[1],q[0] SWAP q[0],q[2]
                    Toffoli q[0],q[2],q[1] qft q phase_oracle q matches |101> diffuse q"""
        logical = reference_qasm(self.command("compile", "-", source=source).stdout)
        pivot = max(range(len(logical)), key=lambda i: abs(logical[i]))
        for gate in ("cx", "cz", "ecr"):
            with self.subTest(gate=gate):
                self.exchange = Exchange(gate)
                self.exchange.device["coupling_map"] = [[1,0], [2,1]]
                report = self.run_job(source, "--backend", "ibm")
                self.assertEqual(report.returncode, 0, report.stderr)
                assembly = self.exchange.jobs[0]["params"]["pubs"][0][0]
                rows = ["qreg q[3];"]
                for line in assembly.splitlines():
                    if line.startswith(("OPENQASM", "include", "bit[", "gate ecr", "m0[")):
                        continue
                    line = re.sub(r"\$(\d+)", r"q[\1]", line)
                    if line.startswith("sx "):
                        rows.append(line.replace("sx ", "rx(1.5707963267948966) "))
                    elif line.startswith("ecr "):
                        a,b = re.findall(r"q\[\d+\]", line)
                        rows.extend([f"s {a};", f"rx(1.5707963267948966) {b};", f"cx {a},{b};", f"x {a};"])
                    else:
                        rows.append(line)
                actual = reference_qasm("\n".join(rows))
                phase = actual[pivot]/logical[pivot]
                self.assertAlmostEqual(abs(phase), 1, places=10)
                for a,b in zip(actual, logical):
                    self.assertLess(abs(a-phase*b), 1e-10)

    def test_declines_unsupported_device_before_post(self):
        self.exchange.device["coupling_map"] = []
        result = self.run_job(BELL, "--backend", "ibm")
        self.assertEqual(result.returncode, 1)
        self.assertIn("connected", result.stderr)
        self.assertFalse(self.exchange.jobs)

    def test_remote_errors_and_bad_samples(self):
        for case, expected in [("auth", "401"), ("failed", "Failed"), ("status", "503"),
                               ("short", "shot count"), ("range", "hexadecimal"), ("nondigit", "hexadecimal")]:
            with self.subTest(case=case):
                self.exchange = Exchange()
                if case == "auth": self.exchange.iam_error = True
                if case == "failed": self.exchange.status = ["Failed"]
                if case == "status": self.exchange.status_error = True
                if case == "short": self.exchange.data["m0"]["samples"].pop()
                if case == "range": self.exchange.data["m0"]["samples"][0] = "0x4"
                if case == "nondigit": self.exchange.data["m0"]["samples"][0] = "0x1z"
                result = self.run_job(BELL, "--backend", "ibm")
                self.assertEqual(result.returncode, 1)
                self.assertIn(expected, result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertNotIn(self.exchange.key, result.stderr)

    def test_queue_and_rate_limit(self):
        self.exchange.limited = True
        self.exchange.status = ["Queued", "Completed"]
        result = self.run_job(BELL, "--backend", "ibm")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.exchange.jobs), 1)
        self.assertEqual(self.exchange.calls.count(("GET", "/api/v1/jobs/fixture-job?exclude_params=true")), 2)

    def test_config_permissions_and_dotenv_precedence(self):
        self.assertEqual(self.command("auth", "--ibm", "saved", "--instance", INSTANCE, "--backend", "saved").returncode, 0)
        config = self.directory/".ket/config"
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(config.read_text())["ibm"]["token"], "saved")
        (self.directory/".env").write_text("IBM_QUANTUM_TOKEN='test+key&only'\nIBM_QUANTUM_BACKEND=dotenv\n")
        del self.env["IBM_QUANTUM_TOKEN"], self.env["IBM_QUANTUM_INSTANCE"]
        result = self.run_job(BELL, "--backend", "ibm")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_local_override_and_shared_links(self):
        source = "circuit c() { qubit q Ry(π) q } run c() on ibm"
        for key in ("IBM_QUANTUM_TOKEN", "IBM_QUANTUM_INSTANCE", "IBM_QUANTUM_BACKEND"):
            del self.env[key]
        result = self.command("run", "-", "--backend", "local", "--shots", "1", "--json", source=source)
        self.assertEqual(json.loads(result.stdout)["counts"], {"1": 1})
        result = self.command("run", "-", source=source)
        self.assertEqual(result.returncode, 1)
        self.assertIn("instance CRN", result.stderr)
        result = self.command("viz", "-", "--url", source=source)
        query = parse_qs(urlsplit(result.stdout.strip()).query)
        self.assertEqual(base64.urlsafe_b64decode(query["p"][0]+"==").decode(), source)

if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
