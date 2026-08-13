// Amostra cold starts: espera W segundos ocioso, da 1 hit, alterna entre os Workers
// Uso: node scripts/cold-sample.mjs <url-a> <url-b> [wait_s] [rounds]
import { performance } from "node:perf_hooks";

const [urlA, urlB] = process.argv.slice(2, 4);
const waitS = parseInt(process.argv[4] ?? "75", 10);
const rounds = parseInt(process.argv[5] ?? "4", 10);
if (!urlA || !urlB) process.exit(console.error("Uso: node scripts/cold-sample.mjs <url-a> <url-b> [wait_s] [rounds]"));

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
async function hit(url, label, tag) {
  const t0 = performance.now();
  const res = await fetch(`${url}/health?t=${tag}-${Date.now()}`);
  await res.text();
  const t1 = performance.now();
  console.log(`  ${label.padEnd(24)} ${(t1 - t0).toFixed(1).padStart(7)} ms`);
  return t1 - t0;
}

const a = [];
const b = [];
console.log(`Esperando ${waitS}s ocioso entre hits, ${rounds} rounds por worker (~${(waitS * rounds * 2) / 60} min)\n`);
for (let i = 0; i < rounds; i++) {
  await sleep(waitS);
  console.log(`round ${i + 1}:`);
  a.push(await hit(urlA, "padrao (esbuild)", `a${i}`));
  await sleep(waitS);
  b.push(await hit(urlB, "prebundled (rolldown)", `b${i}`));
}

const s = (arr) => {
  const sorted = [...arr].sort((x, y) => x - y);
  return { min: sorted[0], med: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], n: arr.length };
};
console.log("\n=== COLD SAMPLES ===");
const sa = s(a), sb = s(b);
console.log(`padrao (esbuild)       n=${sa.n} min ${sa.min.toFixed(1)} med ${sa.med.toFixed(1)} max ${sa.max.toFixed(1)} ms`);
console.log(`prebundled (rolldown)  n=${sb.n} min ${sb.min.toFixed(1)} med ${sb.med.toFixed(1)} max ${sb.max.toFixed(1)} ms`);
console.log(`\nraw padrao:      ${JSON.stringify(a.map((x) => x.toFixed(1)))}`);
console.log(`raw prebundled:  ${JSON.stringify(b.map((x) => x.toFixed(1)))}`);
