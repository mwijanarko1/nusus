import { expect, test } from "bun:test";
import { createTransport } from "../src/transport.js";

test("transport maps status, malformed JSON, and cancellation", async () => {
  const rateLimited = createTransport({
    fetch: (async () => new Response("slow down", { status: 429, headers: { "retry-after": "3" } })) as typeof fetch,
  });
  await expect(rateLimited("search", {})).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfter: 3 });

  const malformed = createTransport({
    fetch: (async () => new Response("not json")) as typeof fetch,
  });
  await expect(malformed("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

  const waiting = createTransport({
    fetch: ((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch,
  });
  const controller = new AbortController();
  const request = waiting("page", {}, controller.signal);
  controller.abort();
  await expect(request).rejects.toMatchObject({ code: "ABORTED" });

  let called = false;
  const preAborted = createTransport({
    fetch: (async () => {
      called = true;
      return Response.json({});
    }) as typeof fetch,
  });
  const alreadyStopped = new AbortController();
  alreadyStopped.abort();
  await expect(preAborted("page", {}, alreadyStopped.signal)).rejects.toMatchObject({ code: "ABORTED" });
  expect(called).toBe(false);
});
