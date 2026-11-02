// Composes schema/*.graphql into the one SDL document AppSync takes. Each entity has its own file
// that adds its fields with `extend type Query { ... }` / `extend type Mutation { ... }`, so tickets
// working in parallel don't edit the same lines. base.graphql declares the root types.
// Used by infra (the AppSync definition and one resolver per root field) and e2e/backend.ts.
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import {
  Kind, parse, print,
  type DefinitionNode, type FieldDefinitionNode, type ObjectTypeDefinitionNode,
} from "graphql";

export const SCHEMA_DIR = __dirname;

/** One SDL document from several, with every object type extension merged into its definition. */
export function composeSchema(sources: readonly string[]): string {
  const doc = parse(sources.join("\n"));
  const defs = new Map<string, ObjectTypeDefinitionNode>();
  const rest: DefinitionNode[] = [];
  for (const d of doc.definitions) {
    if (d.kind === Kind.OBJECT_TYPE_DEFINITION) defs.set(d.name.value, { ...d, fields: [...(d.fields ?? [])] });
    else rest.push(d);
  }
  const others: DefinitionNode[] = [];
  for (const d of rest) {
    if (d.kind !== Kind.OBJECT_TYPE_EXTENSION) {
      others.push(d);
      continue;
    }
    const base = defs.get(d.name.value);
    if (!base) throw new Error(`extend type ${d.name.value}: no such type`);
    const fields = base.fields as FieldDefinitionNode[];
    for (const f of d.fields ?? []) {
      if (fields.some((x) => x.name.value === f.name.value)) throw new Error(`${d.name.value}.${f.name.value} is defined twice`);
      fields.push(f);
    }
  }
  return print({ ...doc, definitions: [...defs.values(), ...others] });
}

/** The repo's schema: every schema/*.graphql, base.graphql first, the rest by name. */
export function composeSchemaDir(dir = SCHEMA_DIR): string {
  const files = readdirSync(dir).filter((f) => f.endsWith(".graphql")).sort((a, b) => (a === "base.graphql" ? -1 : b === "base.graphql" ? 1 : a < b ? -1 : 1));
  return composeSchema(files.map((f) => readFileSync(path.join(dir, f), "utf8")));
}

/** Field names of the Query and Mutation types, in schema order. */
export function rootFields(sdl: string): { Query: string[]; Mutation: string[] } {
  const out = { Query: [] as string[], Mutation: [] as string[] };
  for (const d of parse(sdl).definitions) {
    if (d.kind === Kind.OBJECT_TYPE_DEFINITION && (d.name.value === "Query" || d.name.value === "Mutation")) {
      out[d.name.value] = (d.fields ?? []).map((f) => f.name.value);
    }
  }
  return out;
}
