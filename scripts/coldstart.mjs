// Mede TTFB de um Worker deployado, disparando requisicoes sequenciais.
// Uso: node scripts/coldstart.mjs https://rolldown-test.<subdominio>.workers.dev
//      node scripts/coldstart.mjs <url> [num_requests]
//
// Dica: rode depois de deixar o Worker ocioso por alguns minutos
// (isolate evicts no free plan). Cold start aparece como outlier no TTFB.
// Compare as distribuicoes dos dois deploys (padrao vs prebundled).

const url = process.argv[2];
const n = parseInt(process.argv[3] ?? "50", 10);
if (!url) {
  console.error("Uso: node scripts/coldstart.mjs <url-do-worker> [num_requests]");
  process.exit(1);
}

const ttfb = [];
for (let i = 0; i < n; i++) {
  const t0 = performance.now();
  const res = await fetch(`${url}/health?t=${Date.now()}-${i}`);
  await res.text();
  const t1 = performance.now();
  ttfb.push(t1 - t0);
}

ttfb.sort((a, b) => a - b);
const stats = (arr) => arr[Math.floor(arr.length * 0.95)];
const mediana = ttfb[Math.floor(ttfb.length / 2)];

console.log(`\n${url}`);
console.log(`  requests : ${n}`);
console.log(`  min      : ${ttfb[0].toFixed(1)} ms (isolate quente)`);
console.log(`  mediana  : ${mediana.toFixed(1)} ms`);
console.log(`  p95      : ${stats(ttfb).toFixed(1)} ms (aqui aparecem os cold starts)`);
console.log(`  max      : ${ttfb[ttfb.length - 1].toFixed(1)} ms`);
