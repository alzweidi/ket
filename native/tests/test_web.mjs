import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import createKet from '../../playground/engine/ket.mjs';

const binary = process.argv[2];
const engine = await createKet();
function evaluate(source, run, shots, seed) {
  const pointer = engine.ccall('ket_web', 'number', ['string', 'number', 'number', 'number'],
                               [source, run, shots, seed]);
  assert.ok(pointer);
  try { return JSON.parse(engine.UTF8ToString(pointer)); }
  finally { engine._free(pointer); }
}
const examples = ['bell-state', 'grover', 'qft', 'teleportation', 'fringes'];
for (const name of examples) {
  const file = new URL('../../examples/' + name + '.ket', import.meta.url);
  const source = readFileSync(file, 'utf8');
  const data = evaluate(source, true, 4096, 42);
  const run = execFileSync(binary, ['run', '-', '--shots', '4096', '--seed', '42', '--json'], {input: source});
  assert.deepEqual(data.result, JSON.parse(run), name);
  assert.equal(data.qasm, execFileSync(binary, ['compile', '-'], {input: source, encoding: 'utf8'}));
  assert.ok(data.circuit.ops.length > 0);
}
assert.match(evaluate('qubit q X missing', true, 1, 0).error.message, /declared/);
assert.equal(evaluate('qubit q X q', true, 5, 0).result.counts['1'], 5);
const nested = 'qubit q[2] let a = measure q[0] if a == 0 { if a == 0 { X q[1] } } let b = measure q[1]';
assert.deepEqual(evaluate(nested, true, 8, 0).result.counts, {'01': 8});
assert.match(evaluate(nested, false, 1, 0).qasmError.message, /nested/);
assert.match(evaluate('circuit c() {qubit q} run c() on ibm', true, 1, 0).error.message, /IBM/);
assert.equal(evaluate('qubit q repeat 200 { X q }', false, 1, 0).circuit.ops.length, 160);
console.log(`WebAssembly matches native counts and OpenQASM for all ${examples.length} examples.`);
