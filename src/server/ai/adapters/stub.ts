// DEV-ONLY stub provider (RADAR_DEV_STUBS=1). Deterministic outputs so every flow can run without API keys.
// Feature modules register purpose-specific generators with registerStub(); unknown purposes get schema-shaped filler.
import type { AiInput, ProviderResult } from '../index';

type StubFn = (input: AiInput, ctx: any) => any;
const g = globalThis as unknown as { __radarStubs?: Map<string, StubFn> };
const stubs = (g.__radarStubs ??= new Map());
export function registerStub(purpose: string, fn: StubFn) { stubs.set(purpose, fn); }

function fill(schema: any, key = 'value'): any {
  if (!schema) return null;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) return fill(schema.anyOf[0], key);
  const t = Array.isArray(schema.type) ? schema.type.find((x: string) => x !== 'null') : schema.type;
  if (t === 'object') { const o: any = {}; for (const [k, v] of Object.entries(schema.properties || {})) o[k] = fill(v, k); return o; }
  if (t === 'array') return [fill(schema.items, key), fill(schema.items, key)];
  if (t === 'number' || t === 'integer') return 1;
  if (t === 'boolean') return false;
  return `Sample ${key}`;
}

export async function stubRun(input: AiInput, jsonSchema: any): Promise<ProviderResult> {
  await new Promise(r => setTimeout(r, 120));
  const fn = stubs.get(input.purpose);
  if (fn) {
    const out = await fn(input, input.stubContext);
    if (typeof out === 'string') {
      if (input.onDelta) for (const chunk of out.match(/.{1,24}/gs) || []) { input.onDelta(chunk); await new Promise(r => setTimeout(r, 15)); }
      return { text: out, citations: [] };
    }
    return { text: JSON.stringify(out), json: out, citations: [] };
  }
  if (jsonSchema) { const j = fill(jsonSchema); return { text: JSON.stringify(j), json: j, citations: [] }; }
  const t = 'Sample text from the dev stub.';
  input.onDelta?.(t);
  return { text: t, citations: [] };
}
