/** One Server-Sent Events frame. `data` is the concatenated data lines. */
export interface SseEvent {
  event?: string;
  data: string;
  id?: string;
}

/** Parse one frame (fields separated by "\n"); returns undefined if it has no fields. */
function parseFrame(frame: string): SseEvent | undefined {
  const ev: SseEvent = { data: "" };
  const dataLines: string[] = [];
  let saw = false;
  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // blank / comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1); // strip one leading space
    if (field === "data") {
      dataLines.push(value);
      saw = true;
    } else if (field === "event") {
      ev.event = value;
      saw = true;
    } else if (field === "id") {
      ev.id = value;
      saw = true;
    }
  }
  if (!saw) return undefined;
  ev.data = dataLines.join("\n");
  return ev;
}

/**
 * Parse an SSE byte stream (already decoded to text chunks) into events.
 * Buffers across chunk boundaries; frames are separated by a blank line.
 */
export async function* parseSseStream(
  chunks: AsyncIterable<string>,
): AsyncIterable<SseEvent> {
  let buf = "";
  for await (const chunk of chunks) {
    buf += chunk.replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const ev = parseFrame(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
      if (ev) yield ev;
    }
  }
  const tail = parseFrame(buf);
  if (tail) yield tail;
}
