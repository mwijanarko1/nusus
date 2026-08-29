import { expect, test } from "bun:test";
import { NususError } from "../src/errors.js";
import { createTransport } from "../src/transport.js";

test("transport maps status, malformed JSON, and cancellation", async () => {
  const rateLimited = createTransport({
    fetch: async () => new Response("slow down", { status: 429, headers: { "retry-after": "3" } }),
  });
  await expect(rateLimited("search", {})).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfter: 3 });

  const malformed = createTransport({
    fetch: async () => new Response("not json"),
  });
  await expect(malformed("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

  const waiting = createTransport({
    fetch: async (_input, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    },
  });
  const controller = new AbortController();
  const request = waiting("page", {}, controller.signal);
  controller.abort();
  await expect(request).rejects.toMatchObject({ code: "ABORTED" });

  let called = false;
  const preAborted = createTransport({
    fetch: async () => {
      called = true;
      return Response.json({});
    },
  });
  const alreadyStopped = new AbortController();
  alreadyStopped.abort();
  await expect(preAborted("page", {}, alreadyStopped.signal)).rejects.toMatchObject({ code: "ABORTED" });
  expect(called).toBe(false);
});

test("rejects a non-function fetch implementation as INVALID_ARGUMENT", () => {
  const badFetch: typeof fetch = JSON.parse(`"not-a-function"`);
  try {
    createTransport({ fetch: badFetch });
    throw new Error("expected INVALID_ARGUMENT");
  } catch (error) {
    expect(error).toMatchObject({ code: "INVALID_ARGUMENT" });
  }
});

class InjectedJsonResponse extends Response {
  payload: unknown = undefined;
  override json() {
    return Promise.resolve(this.payload);
  }
}

test("rejects non-JSON values from an injected response as INVALID_RESPONSE", async () => {
  const bigintResponse = new InjectedJsonResponse();
  bigintResponse.payload = { bad: 1n };
  const bigint = createTransport({ fetch: async () => bigintResponse });
  await expect(bigint("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

  const nestedResponse = new InjectedJsonResponse();
  nestedResponse.payload = { ok: 1, bad: { nested: Infinity } };
  const nested = createTransport({ fetch: async () => nestedResponse });
  await expect(nested("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("rejects non-plain objects and prototype attacks as INVALID_RESPONSE", async () => {
  const ownProtoWithDate = {};
  Object.defineProperty(ownProtoWithDate, "__proto__", {
    value: new Date(),
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const cases: unknown[] = [
    new (class CustomClass {})(),
    new Date(),
    new Map(),
    Object.create({ id: 1, name: "موروث" }),
    { ok: 1, nested: Object.create({ id: 5 }) },
    ownProtoWithDate,
  ];
  for (const value of cases) {
    const response = new InjectedJsonResponse();
    response.payload = value;
    const transport = createTransport({ fetch: async () => response });
    await expect(transport("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  }
});

test("wraps a NususError rejected by response.json() as INVALID_RESPONSE, not spoofed", async () => {
  const spoofingResponse = new InjectedJsonResponse();
  spoofingResponse.json = () => Promise.reject(new NususError("NOT_FOUND", "attacker-selected"));
  const transport = createTransport({ fetch: async () => spoofingResponse });
  await expect(transport("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("rejects symbol-keyed, non-enumerable, accessor, sparse array, and array-extra properties", async () => {
  const sym = Symbol("bad");
  const symbolKeyed = { ok: 1 };
  Object.defineProperty(symbolKeyed, sym, { value: () => {}, enumerable: true, configurable: true });
  const symbolResponse = new InjectedJsonResponse();
  symbolResponse.payload = symbolKeyed;
  await expect(createTransport({ fetch: async () => symbolResponse })("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

  const nonEnumerable = { ok: 1 };
  Object.defineProperty(nonEnumerable, "bad", { value: 1n, enumerable: false, configurable: true });
  const nonEnumResponse = new InjectedJsonResponse();
  nonEnumResponse.payload = nonEnumerable;
  await expect(createTransport({ fetch: async () => nonEnumResponse })("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

  const withGetter = { ok: 1 };
  Object.defineProperty(withGetter, "bad", { get: () => 1n, enumerable: true, configurable: true });
  const getterResponse = new InjectedJsonResponse();
  getterResponse.payload = withGetter;
  await expect(createTransport({ fetch: async () => getterResponse })("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

  const sparse: number[] = [];
  sparse[0] = 1;
  sparse[2] = 3;
  const sparseResponse = new InjectedJsonResponse();
  sparseResponse.payload = sparse;
  await expect(createTransport({ fetch: async () => sparseResponse })("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

  const arrayExtra = [1, 2, 3];
  Object.defineProperty(arrayExtra, "custom", { value: 1n, enumerable: true, configurable: true });
  const arrayExtraResponse = new InjectedJsonResponse();
  arrayExtraResponse.payload = arrayExtra;
  await expect(createTransport({ fetch: async () => arrayExtraResponse })("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("rejects symbol-keyed array properties without invoking accessors", async () => {
  const sym = Symbol("bad");
  const withSymbolArray = [1, 2, 3];
  Object.defineProperty(withSymbolArray, sym, { value: 1n, enumerable: true, configurable: true });
  const symbolArrayResponse = new InjectedJsonResponse();
  symbolArrayResponse.payload = withSymbolArray;
  await expect(createTransport({ fetch: async () => symbolArrayResponse })("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

  let getterCalled = false;
  const withAccessorIndex = [1, 2, 3];
  Object.defineProperty(withAccessorIndex, "1", {
    get: () => { getterCalled = true; return 1n; },
    enumerable: true,
    configurable: true,
  });
  const accessorResponse = new InjectedJsonResponse();
  accessorResponse.payload = withAccessorIndex;
  await expect(createTransport({ fetch: async () => accessorResponse })("page", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  expect(getterCalled).toBe(false);
});
