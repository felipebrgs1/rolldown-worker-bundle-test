// Benchmark intercalado entre dois Workers (evita vies de ordem/rota)
// Uso: node scripts/bench.mjs <url-a> <url-b> [warm_requests]
import { performance } from "node:perf_hooks";

const [urlA, urlB] = process.argv.slice(2, 4);
const n = parseInt(process.argv[4] ?? "60", 10);
if (!urlA || !urlB) {
  console.error("Uso: node scripts/bench.mjs <url-a> <url-b> [warm_requests]");
  process.exit(1);
}

async function timeIt(url, label) {
  const t0 = performance.now();
  const res = await fetch(url);
  const body = await res.text();
  const t1 = performance.now();
  console.log(`  ${label.padEnd(22)} ${res.status} ${(t1 - t0).toFixed(1).padStart(7)} ms`);
  return t1 - t0;
}

function stats(name, arr) {
  arr.sort((a, b) => a - b);
  const med = arr[Math.floor(arr.length / 2)];
  const p95 = arr[Math.floor(arr.length * 0.95)];
  console.log(
    `${name.padEnd(28)} min ${arr[0].toFixed(1).padStart(7)} ms | med ${med.toFixed(1).padStart(7)} ms | p95 ${p95.toFixed(1).padStart(7)} ms | max ${arr[arr.length - 1].toFixed(1).padStart(7)} ms`,
  );
}

// 1) primeiro hit de cada (mais proximo de cold start possivel sem esperar eviction)
console.log("=== PRIMEIRO HIT (pos-deploy, mais frio que conseguimos) ===");
const coldA = await timeIt(`${urlA}/health?t=cold-${Date.now()}`, "padrao (esbuild)");
const coldB = await timeIt(`${urlB}/health?t=cold-${Date.now()}`, "prebundled (rolldown)");

// 2) warm: intercalado A,B,A,B...
console.log(`\n=== WARM (${n} requests cada, intercalados) ===`);
const warmA = [];
const warmB = [];
for (let i = 0; i < n; i++) {
  const t0 = performance.now();
  await (await fetch(`${urlA}/health?t=${Date.now()}-${i}-a`)).text();
  warmA.push(performance.now() - t0);

  const t1 = performance.now();
  await (await fetch(`${urlB}/health?t=${Date.now()}-${i}-b`)).text();
  warmB.push(performance.now() - t1);
}

console.log("\n=== RESULTADO ===");
console.log(`cold:  padrao ${coldA.toFixed(1)} ms | prebundled ${coldB.toFixed(1)} ms`);
stats("warm padrao (esbuild)", warmA);
stats("warm prebundled (rolldown)", warmB);
