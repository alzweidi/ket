import createKet from './engine/ket.mjs';

const engine = createKet();
self.onmessage = async ({data}) => {
  try {
    const {source, run, shots, seed} = data;
    if (source.includes('\0') || new TextEncoder().encode(source).length > 1048576)
      throw new Error('Source must be text of at most 1 MiB without NUL bytes.');
    const module = await engine;
    const ptr = module.ccall('ket_web', 'number', ['string', 'number', 'number', 'number'],
                             [source, run, shots, seed]);
    if (!ptr) throw new Error('Out of memory reading the compiler response.');
    try { self.postMessage(JSON.parse(module.UTF8ToString(ptr))); }
    finally { module._free(ptr); }
  } catch (error) {
    self.postMessage({error: {message: error.message}});
  }
};
