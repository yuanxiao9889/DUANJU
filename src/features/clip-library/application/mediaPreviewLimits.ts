export const CLIP_AUDIO_WAVEFORM_MAX_BYTES = 24 * 1024 * 1024;
export const CLIP_DETAIL_VIDEO_FALLBACK_MAX_BYTES = 96 * 1024 * 1024;

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function readResponseArrayBufferWithinLimit(
  response: Response,
  maxBytes: number
): Promise<ArrayBuffer> {
  const contentLength = parseContentLength(response.headers.get('content-length'));
  if (contentLength !== null && contentLength > maxBytes) {
    throw new Error(`Media preview is too large (${contentLength} bytes)`);
  }

  if (!response.body) {
    if (contentLength === null) {
      throw new Error('Cannot safely read media preview without a stream or content length');
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`Media preview is too large (${buffer.byteLength} bytes)`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Media preview is too large (${totalBytes} bytes)`);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged.buffer;
}

export async function readResponseBlobWithinLimit(
  response: Response,
  maxBytes: number,
  fallbackType = ''
): Promise<Blob> {
  const buffer = await readResponseArrayBufferWithinLimit(response, maxBytes);
  const responseType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
  return new Blob([buffer], { type: responseType || fallbackType });
}
