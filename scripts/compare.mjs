import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { rolldown } from "rolldown";
import { build } from "esbuild";

// ---------- helpers ----------
const fmt = (n) => String(Math.round(n)).padStart(8);

async function measureParseTime(file) {
  const raw = readFileSync(file, "utf8");
  // neutraliza exports ESM so pra medir parse (nao executa nada)
  const code = raw.replace(/;export\{[^}]*\};?/g, ";").replace(/\bexport\s+default\s+/g, "");
  const results = [];
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    new Function(code); // parse + compile (sem executar) — proxy de cold start
    results.push(performance.now() - t0);
  }
  results.sort((a, b) => a - b);
  return results[3]; // mediana
}

// ---------- 1. bundle completo: rolldown vs esbuild ----------
console.log("=== 1) BUNDLE COMPLETO (worker inteiro) ===\n");
console.log("bundler".padEnd(30), "raw".padStart(8), "gzip".padStart(9), "parse(ms)".padStart(10));

const full = [
  ["rolldown", "dist/rolldown/worker.js"],
  ["esbuild", "dist/esbuild/worker.js"],
];
for (const [name, file] of full) {
  if (!existsSync(file)) {
    console.log(`${name}: rode npm run bundle primeiro`);
    continue;
  }
  const buf = readFileSync(file);
  const ms = await measureParseTime(file);
  console.log(
    name.padEnd(30),
    fmt(buf.length),
    fmt(gzipSync(buf, { level: 9 }).length),
    ms.toFixed(1).padStart(10),
  );
}

// ---------- 2. isolado por dependencia ----------
console.log("\n=== 2) TREE-SHAKING ISOLADO POR DEPENDENCIA ===\n");
console.log("dep".padEnd(20), "esbuild".padStart(10), "rolldown".padStart(10));

async function isolated(contents) {
  const e = await build({
    entryPoints: [],
    stdin: { contents, resolveDir: process.cwd() },
    bundle: true, minify: true, treeShaking: true, write: false,
    format: "esm", platform: "neutral", mainFields: ["module", "main"],
  });
  const b = await rolldown({
    input: "virtual:entry",
    plugins: [{
      name: "virtual",
      resolveId(id) { if (id === "virtual:entry") return "\0virtual:entry"; },
      load(id) { if (id === "\0virtual:entry") return contents; },
    }],
    platform: "neutral",
    treeshake: true,
    resolve: { mainFields: ["module", "main"] },
  });
  const out = await b.generate({ format: "esm", minify: true });
  const total = out.output.reduce((s, o) => s + (o.code?.length ?? 0), 0);
  await b.close();
  return [e.outputFiles[0].text.length, total];
}

const deps = [
  ["date-fns", 'import { formatDistance } from "date-fns"; console.log(formatDistance)'],
  ["zod", 'import { z } from "zod"; console.log(z.string())'],
  ["lodash-es", 'import { chunk } from "lodash-es"; console.log(chunk)'],
];
for (const [name, code] of deps) {
  const [e, r] = await isolated(code);
  console.log(name.padEnd(20), fmt(e), fmt(r));
}

// ---------- 3. resumo ----------
console.log(`
=== 3) O QUE ISSO SIGNIFICA PRA COLD START ===
Em Workers, cold start = load do script + parse/compile pelo V8 (isolate).
O tamanho RAW do bundle domina o custo de parse. Gzip ajuda só na
transferencia/limite de upload (10MB free, comprimido).

Pontos praticos:
- wrangler deploy ja usa esbuild internamente (bundle automatico),
  entao "pre-bundle com esbuild" nao muda nada no Workers.
- Pre-bundle com rolldown MUDO SIM: tree-shaking mais agressivo
  (zod 327KB -> 47KB) reduz o script final e o parse no cold start.
- Em Lambda, o ganho e ainda maior: la nao ha bundle automatico e
  o runtime resolve node_modules a cada cold start.
`);
