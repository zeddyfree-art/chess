// Runs the Maia-3 ONNX model off the main thread.
import * as ort from 'onnxruntime-web/wasm';

let session: ort.InferenceSession | null = null;

type Msg =
  | { type: 'init'; model: ArrayBuffer }
  | { type: 'run'; id: number; tokens: ArrayBuffer; eloSelf: number; eloOppo: number };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      // GitHub Pages cannot enable cross-origin isolation, so no threads. The .wasm file
      // itself is emitted by Vite next to this worker.
      ort.env.wasm.numThreads = 1;
      session = await ort.InferenceSession.create(new Uint8Array(msg.model));
      postMessage({ type: 'ready' });
      return;
    }
    if (!session) throw new Error('Maia is not loaded');
    const out = await session.run({
      tokens: new ort.Tensor('float32', new Float32Array(msg.tokens), [1, 64, 12]),
      elo_self: new ort.Tensor('float32', Float32Array.from([msg.eloSelf]), [1]),
      elo_oppo: new ort.Tensor('float32', Float32Array.from([msg.eloOppo]), [1]),
    });
    const move = new Float32Array(out.logits_move.data as Float32Array);
    const value = new Float32Array(out.logits_value.data as Float32Array);
    postMessage({ type: 'result', id: msg.id, move: move.buffer, value: value.buffer }, { transfer: [move.buffer, value.buffer] });
  } catch (err) {
    postMessage({ type: 'error', id: 'id' in msg ? msg.id : undefined, message: (err as Error).message });
  }
};
