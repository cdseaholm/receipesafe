export async function accountJSON(request: Request, maximum = 8192): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) throw new Error('Request too large');
  let text = '';
  if (request.body?.getReader) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) { await reader.cancel(); throw new Error('Request too large'); }
        text += decoder.decode(value, {stream: true});
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  } else {
    text = await request.text();
    if (new TextEncoder().encode(text).length > maximum) throw new Error('Request too large');
  }
  const result = JSON.parse(text);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid request');
  return result;
}
