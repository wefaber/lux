import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildSchema, parse, validate } from "graphql";
import { typeDefs } from "../src/graphql/schema";

// Recorre src/ del frontend, extrae cada documento GraphQL (template literal que
// empieza con query/mutation) y lo valida contra el SDL que sirve la API. Es la
// prueba de que ningun selection set de la app queda sin campo en el backend.
const SRC = process.env.FRONTEND_SRC ?? "../src";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const OPERATION = /^(query|mutation)\s+\w+/;
const schema = buildSchema(typeDefs);
const files = walk(SRC);

const seen = new Map<string, string>();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/`([^`]*)`/gs)) {
    const doc = match[1].trim();
    if (!OPERATION.test(doc)) continue;
    if (!seen.has(doc)) seen.set(doc, file);
  }
}

let failures = 0;
const operationNames = new Set<string>();
for (const [doc, file] of seen) {
  const name = doc.match(OPERATION)![0].split(/\s+/)[1];
  operationNames.add(name);
  try {
    const errors = validate(schema, parse(doc));
    if (errors.length > 0) {
      failures++;
      console.log(`FAIL ${name} (${file})`);
      for (const e of errors) console.log(`  - ${e.message}`);
    }
  } catch (error) {
    failures++;
    console.log(`PARSE FAIL ${name} (${file}): ${(error as Error).message}`);
  }
}

console.log(`\nDocumentos encontrados: ${seen.size}`);
console.log(`Operaciones distintas: ${operationNames.size}`);
console.log(`Errores de validacion: ${failures}`);
console.log(`\n${[...operationNames].sort().join("\n")}`);
process.exitCode = failures > 0 ? 1 : 0;
