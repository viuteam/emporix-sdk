import { describe, it, expect } from "vitest";
import { parseSseStream, type SseEvent } from "../src/core/sse";

async function* from(...parts: string[]): AsyncIterable<string> {
  for (const p of parts) yield p;
}
async function collect(chunks: AsyncIterable<string>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of parseSseStream(chunks)) out.push(e);
  return out;
}

describe("parseSseStream", () => {
  it("parses one event per blank-line-delimited frame", async () => {
    expect(await collect(from("data: hello\n\ndata: world\n\n"))).toEqual([
      { data: "hello" },
      { data: "world" },
    ]);
  });

  it("joins multiple data lines with newlines and reads event/id fields", async () => {
    expect(await collect(from("event: msg\nid: 7\ndata: a\ndata: b\n\n"))).toEqual([
      { event: "msg", id: "7", data: "a\nb" },
    ]);
  });

  it("reassembles frames split across chunk boundaries and normalizes CRLF", async () => {
    expect(await collect(from("data: ab", "c\r\n\r\ndata: d\n\n"))).toEqual([
      { data: "abc" },
      { data: "d" },
    ]);
  });

  it("ignores comment lines and flushes a trailing frame with no blank line", async () => {
    expect(await collect(from(": keep-alive\ndata: x\n\ndata: y"))).toEqual([
      { data: "x" },
      { data: "y" },
    ]);
  });
});
