const byId = id => document.getElementById(id);
const source = byId('source'), example = byId('example'), status = byId('status');
let worker, timer, working = false, latest = {}, revision = 0;

function el(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}
function view(name) {
  for (const button of document.querySelectorAll('[data-view]')) {
    const active = button.dataset.view === name;
    button.setAttribute('aria-pressed', String(active));
    byId(button.dataset.view).hidden = !active;
  }
}
function showResults(result) {
  const panel = byId('results');
  panel.replaceChildren();
  if (!result) { panel.textContent = 'Run the circuit to see its measurements.'; return; }
  const rows = Object.entries(result.counts).sort((a, b) => b[1] - a[1]);
  const table = el('table', ''), header = table.createTHead().insertRow();
  for (const label of ['Outcome', 'Count', 'Frequency', '']) header.append(el('th', label));
  const body = table.createTBody();
  for (const [bits, count] of rows.slice(0, 128)) {
    const row = body.insertRow();
    for (const text of [bits, count, (100 * count / result.shots).toFixed(2) + '%']) row.insertCell().textContent = text;
    const bar = document.createElement('meter');
    bar.max = result.shots; bar.value = count; bar.setAttribute('aria-label', bits);
    row.insertCell().append(bar);
  }
  const labels = result.measurements.map(binding => binding.name + '[' + binding.width + ']').join(' · ');
  panel.append(el('p', result.shots.toLocaleString('en-GB') + ' shots · ' + labels), table);
  if (rows.length > 128) panel.append(el('p', 'Showing the 128 most frequent outcomes of ' + rows.length + '.'));
}
function drawCircuit(circuit) {
  const panel = byId('circuit');
  panel.replaceChildren();
  if (!circuit) { panel.textContent = 'Compile or run the circuit to see its gates.'; return; }
  const {qubits, total, ops} = circuit;
  const diagram = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const width = 55 + ops.length * 57, y = q => 35 + q * 36;
  function draw(tag, attrs, text) {
    const node = document.createElementNS(diagram.namespaceURI, tag);
    Object.entries(attrs).forEach(([key, val]) => node.setAttribute(key, val));
    if (text !== undefined) node.textContent = text;
    diagram.append(node); return node;
  }
  diagram.setAttribute('width', width); diagram.setAttribute('height', y(qubits) + 12);
  diagram.setAttribute('role', 'img'); diagram.setAttribute('aria-label', 'Circuit on ' + qubits + ' qubits');
  for (let q = 0; q < qubits; q++) {
    draw('text', {x: 0, y: y(q) + 4, fill: 'currentColor'}, 'q' + q);
    draw('line', {x1: 26, x2: width, y1: y(q), y2: y(q), stroke: '#486076'});
  }
  const list = el('ol', '');
  ops.forEach((op, i) => {
    const x = 64 + i * 57, targets = op.q;
    let description = op.gate + ' ' + targets.map(n => 'q' + n).join(', ');
    if (op.angle !== undefined) description += ' (' + op.angle.toPrecision(5) + ')';
    if (op.binding) description += op.gate === 'if' ? op.binding + ' = ' + op.equals + ' → step ' + (op.end + 1) : ' → ' + op.binding;
    list.append(el('li', description + ' · line ' + op.line));
    if (!targets.length) { draw('text', {x, y: 12, fill: '#ffbf69', 'text-anchor': 'middle'}, 'if'); return; }
    const ys = targets.map(y);
    draw('line', {x1: x, x2: x, y1: Math.min(...ys), y2: Math.max(...ys), stroke: 'currentColor'});
    targets.forEach((q, j) => {
      if (['CX', 'CCX', 'CZ', 'CP'].includes(op.gate) && j < targets.length - 1) {
        draw('circle', {cx: x, cy: y(q), r: 4, fill: 'currentColor'}); return;
      }
      draw('rect', {x: x-21, y: y(q)-11, width: 42, height: 22, rx: 4, fill: '#183248', stroke: '#709ebc'});
      draw('text', {x, y: y(q)+4, 'text-anchor': 'middle', fill: 'currentColor'}, op.gate);
    });
  });
  const detail = el('details', '');
  detail.append(el('summary', 'Gate list and source lines'), list);
  const size = qubits + ' qubits · ' + total + ' operations';
  panel.append(el('p', total > ops.length ? size + ' · showing the first ' + ops.length : size), diagram, detail);
}
function render(data) {
  latest = data;
  showResults(data.result);
  drawCircuit(data.circuit);
  byId('qasm').querySelector('pre').textContent = data.qasm || data.qasmError?.message || 'Compile the circuit to see its OpenQASM.';
  byId('copy').hidden = !data.qasm;
}
function stop() {
  clearTimeout(timer);
  worker?.terminate(); worker = null; working = false;
  byId('run').textContent = 'Run';
}
function execute(run, preview = false) {
  clearTimeout(timer);
  if (working) stop();
  const shots = byId('shots').valueAsNumber;
  if (run && (!Number.isInteger(shots) || shots < 1 || shots > 1000000)) {
    showStatus('Choose between 1 and 1,000,000 shots.', true); return;
  }
  working = true; byId('run').textContent = 'Stop'; showStatus(run ? 'Simulating…' : 'Compiling…');
  if (!worker) worker = new Worker('./worker.mjs', {type: 'module'});
  worker.onmessage = ({data}) => {
    working = false; byId('run').textContent = 'Run'; render(data);
    const error = data.error || (!run && !preview && data.qasmError);
    showStatus(error ? (error.line ? 'Line ' + error.line + ', column ' + error.column + ' · ' : '') + error.message :
      run ? 'Finished · seed ' + data.result.seed : preview ? 'Checked' : 'Compiled', Boolean(error));
    if (!error && !preview) view(run ? 'results' : 'qasm');
  };
  worker.onerror = () => { stop(); render({}); showStatus('Could not load the compiler. Reload the playground to try again.', true); };
  worker.postMessage({source: source.value, run, shots, seed: crypto.getRandomValues(new Uint32Array(1))[0]});
}
function edited() {
  revision++; stop(); render({}); example.value = ''; byId('filename').textContent = '';
  showStatus('Edited');
  timer = setTimeout(() => execute(false, true), 400);
}
async function loadExample(name) {
  const version = ++revision;
  stop(); showStatus('Loading example…');
  try {
    const response = await fetch('./examples/' + name + '.ket');
    if (!response.ok) throw new Error('Could not load the example.');
    const text = await response.text();
    if (version !== revision) return;
    source.value = text; byId('filename').textContent = name + '.ket'; execute(true);
  } catch (error) { if (version === revision) showStatus(error.message, true); }
}
function sharedSource() {
  const p = new URLSearchParams(location.search);
  const encoded = p.get('p') ?? p.get('program');
  if (encoded === null) return null;
  if (encoded.length > 1398104) throw new Error('Shared source exceeds 1 MiB.');
  const bytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}
source.addEventListener('input', edited);
source.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); execute(true); }
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault(); source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end'); edited();
  }
});
example.onchange = () => loadExample(example.value);
byId('run').onclick = () => { if (working) { stop(); showStatus('Stopped'); } else execute(true); };
byId('compile').onclick = () => execute(false);
byId('share').onclick = async () => {
  const bytes = new TextEncoder().encode(source.value);
  if (bytes.length > 1048576) { showStatus('Source exceeds 1 MiB.', true); return; }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const url = new URL(location.href);
  url.search = ''; url.searchParams.set('p', btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''));
  try { await navigator.clipboard.writeText(url.href); showStatus('Share link copied'); }
  catch { window.prompt('Copy this share link', url.href); }
};
byId('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(latest.qasm); showStatus('OpenQASM copied'); }
  catch { showStatus('Select and copy the OpenQASM text below.'); }
};
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => view(b.dataset.view));
render({});
try {
  const text = sharedSource();
  if (text === null) loadExample('bell-state');
  else { source.value = text; example.value = ''; execute(true); }
} catch { showStatus('Invalid shared source. Choose an example or enter a program.', true); }
