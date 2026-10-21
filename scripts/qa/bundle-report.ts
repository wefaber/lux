/* oxlint-disable no-await-in-loop */
// Reporte de composición del bundle: qué paquetes pesan más dentro de los chunks.
// Uso (desde la raíz del repo):
//   bun scripts/qa/bundle-report.ts [outDir]
// Hace un build con sourcemaps en outDir (por defecto /tmp/lux-bundle-report) y suma, por
// paquete de node_modules y por carpeta de src/, los bytes que cada fuente aporta al
// código minificado (según el mapa de fuentes). No modifica el repo.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const outDir = process.argv[2] ?? "/tmp/lux-bundle-report";
const build = Bun.spawnSync(["bunx", "vite", "build", "--sourcemap", "--outDir", outDir, "--emptyOutDir"], {
  stdout: "pipe",
  stderr: "pipe",
});
if (build.exitCode !== 0) {
  console.error(build.stderr.toString());
  process.exit(1);
}

const assets = join(outDir, "assets");
for (const file of readdirSync(assets).filter((f) => f.endsWith(".js"))) {
  const code = readFileSync(join(assets, file));
  console.log(`\n== ${file}  ${(code.length / 1024).toFixed(1)} kB  (gzip ${(gzipSync(code).length / 1024).toFixed(1)} kB)`);
  if (!existsSync(join(assets, `${file}.map`))) continue;
  const map = JSON.parse(readFileSync(join(assets, `${file}.map`), "utf8")) as {
    sources: string[];
    sourcesContent?: string[];
    mappings: string;
  };
  // Aproximación: el tamaño de la fuente original en bytes, agrupada por paquete.
  const byGroup = new Map<string, number>();
  map.sources.forEach((src, i) => {
    const size = map.sourcesContent?.[i]?.length ?? 0;
    const nm = src.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    const group = nm ? nm[1] : "(codigo propio: src/)";
    byGroup.set(group, (byGroup.get(group) ?? 0) + size);
  });
  const total = [...byGroup.values()].reduce((a, b) => a + b, 0);
  [...byGroup.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([g, n]) => console.log(`  ${(n / 1024).toFixed(0).padStart(6)} kB fuente  ${((n / total) * 100).toFixed(1).padStart(5)} %  ${g}`));
}
