import { NususError } from "../errors.js";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = { [key: string]: JsonValue };

export type JsonInput = JsonValue | bigint | symbol | undefined | ((...args: never[]) => void);

const invalid = (): never => {
  throw new NususError("INVALID_RESPONSE", "Turath returned invalid JSON");
};

const isString = (value: JsonInput): value is string => typeof value === "string";
const isBoolean = (value: JsonInput): value is boolean => typeof value === "boolean";
const isFiniteNumber = (value: JsonInput): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPlainObject = (value: JsonInput): value is { [key: string]: JsonValue } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isCanonicalArray = (value: unknown[]): boolean => {
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let i = 0; i < value.length; i += 1) {
    const key = String(i);
    const descriptor = descriptors[key];
    if (descriptor === undefined) return false;
    if (!("value" in descriptor) || !descriptor.enumerable || descriptor.get || descriptor.set) return false;
  }
  for (const key of Object.keys(descriptors)) {
    if (key === "length") continue;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) return false;
  }
  return true;
};

const isCanonicalRecord = (record: { [key: string]: JsonValue }): boolean => {
  if (Object.getOwnPropertySymbols(record).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(record);
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable || descriptor.get || descriptor.set) return false;
  }
  return true;
};

export const toJsonValue = (value: JsonInput): JsonValue => {
  if (value === null) return null;
  if (isString(value)) return value;
  if (isBoolean(value)) return value;
  if (isFiniteNumber(value)) return value;
  if (Array.isArray(value)) {
    if (!isCanonicalArray(value)) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let i = 0; i < value.length; i += 1) {
      toJsonValue(descriptors[String(i)]!.value);
    }
    return value;
  }
  if (isPlainObject(value)) {
    if (!isCanonicalRecord(value)) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      toJsonValue(descriptor.value);
    }
    return value;
  }
  return invalid();
};
