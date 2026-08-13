# Teste: pre-bundle com rolldown/esbuild antes do deploy no Cloudflare Workers

Pergunta: faz sentido usar esbuild/rolldown antes de enviar pra edge/lambda pra melhorar cold start? Teste no Cloudflare Workers, com dois Workers: um leve e um pesado.

**Versões testadas** (agosto/2026): rolldown 1.2.4, esbuild 0.28.2, wrangler 4.123, zod 4.4, date-fns 4.4, lodash-es 4.18, @aws-sdk/client-s3, moment, axios, i18next.

## TL;DR

| Worker | bundle padrão (esbuild/wrangler) | pre-bundle rolldown | cold start | warm |
| ------ | -------------------------------- | ------------------- | ---------- | ---- |
| leve    | 368 KB (81 KB gzip)              | 90 KB (27 KB gzip)   | 164 → **130 ms** (mediana) | 40.3 ms = 40.3 ms |
| pesado  | 782 KB (214 KB gzip)             | 446 KB (143 KB gzip) | 171 → **148 ms** (mediana) | 38.9 ms ≈ 37.7 ms |
| mega 🔥 | 5.75 MB (1.65 MB gzip)           | 4.88 MB (1.45 MB gzip)| cluster frio: **695 ≈ 710 ms** (sem dif. mensurável); cluster quente idêntico | 43.5 ≈ 45.2 ms |

- **Cold start melhora ~13-20%** nos workers leves/pesados com o bundle rolldown (menos script pra parsear).
- **No mega (~5 MB), a diferença de 15% de tamanho some no ruído**: o cold start real (550-950 ms) é dominado por carga do script/colo, não pelo parse incremental.
- **Warm é sempre idêntico** — o código já está compilado; tamanho de bundle não afeta request quente.
- **Teste de fogo**: o wrangler padrão NEM EMPACOTA o worker mega (pngjs/gifwrap usam `require("fs")` nu em CJS); com stubs de builtins, rolldown e esbuild empacotam e rodam.
- No Workers, pré-bundlar com **esbuild é redundante** (o wrangler já usa esbuild internamente). Pré-bundlar com **rolldown** dá ganho real via tree-shaking mais agressivo.
- Em **Lambda** o ganho tende a ser maior: não há bundle automático e o runtime resolve `node_modules` a cada cold start.

## Workers de teste

| Worker | Deps | URLs |
| ------ | ---- | ---- |
| leve | zod, date-fns, lodash-es | [rolldown-test](https://rolldown-test.felipebrgs.workers.dev) / [rolldown-test-prebundled](https://rolldown-test-prebundled.felipebrgs.workers.dev) |
| pesado | + @aws-sdk/client-s3, moment, axios, i18next | [rolldown-heavy](https://rolldown-heavy.felipebrgs.workers.dev) / [rolldown-heavy-prebundled](https://rolldown-heavy-prebundled.felipebrgs.workers.dev) |
| mega 🔥 | + exceljs, pdf-lib, cheerio, highlight.js, three, jimp, openai, @anthropic-ai/sdk, luxon, lodash (CJS) | [rolldown-mega-esbuild](https://rolldown-mega-esbuild.felipebrgs.workers.dev) / [rolldown-mega-prebundled](https://rolldown-mega-prebundled.felipebrgs.workers.dev) |

## Bundles (scripts/build.mjs)

| bundle                     | raw     | gzip   |
| -------------------------- | ------- | ------ |
| leve — rolldown            | 92 KB   | 28 KB  |
| leve — esbuild             | 363 KB  | 78 KB  |
| pesado — rolldown          | 446 KB  | 143 KB |
| pesado — esbuild           | 782 KB  | 214 KB |
| mega — rolldown            | 4.88 MB | 1.45 MB|
| mega — esbuild             | 5.75 MB | 1.65 MB|

Tree-shaking isolado por dependência (minificado):

| dep         | esbuild | rolldown |
| ----------- | ------- | -------- |
| date-fns    | 9.7 KB  | 9.5 KB   |
| zod         | 327 KB  | 48 KB    |
| lodash-es   | 3.2 KB  | 2.4 KB   |

O zod v4 é o caso extremo: o esbuild não remove métodos de classe não usados, o rolldown sim (7x menor). O moment não tree-shake em nenhum dos dois (import default puxa tudo) e domina o orçamento do worker pesado.

## Medição real na Cloudflare (workers.dev, free plan)

Metodologia: `scripts/cold-sample.mjs` — espera 75s de ócio entre hits (suficiente pra forçar eviction do isolate; TTFB salta de ~40ms pra >120ms), alternando entre os dois Workers. `scripts/bench.mjs` — 60-100 requests intercalados pra medir warm.

### Worker leve (n=7 cold samples cada)

| métrica              | padrão (esbuild) | prebundled (rolldown) |
| -------------------- | ---------------- | --------------------- |
| cold start (mediana) | 164 ms           | 130 ms                |
| cold start (min/max) | 123 / 173 ms     | 123 / 170 ms          |
| warm (mediana, n=100)| 40.3 ms          | 40.3 ms               |

Amostras brutas — padrão: `164, 142, 164, 173, 156, 123, 166` | prebundled: `123, 161, 130, 156, 124, 170, 131`

### Worker pesado (n=7 cold samples cada)

| métrica              | padrão (esbuild) | prebundled (rolldown) |
| -------------------- | ---------------- | --------------------- |
| cold start (mediana) | 171 ms           | 148 ms                |
| cold start (min/max) | 128 / 298 ms     | 117 / 190 ms          |
| warm (mediana, n=60) | 38.9 ms          | 37.7 ms               |

Amostras brutas — padrão: `247, 204, 128, 172, 298, 132, 137` | prebundled: `179, 190, 148, 117, 175, 145, 119`

### Worker mega 🔥 (n=12 cold samples cada)

Com ~5 MB de script, o TTFB fica **bimodal**: hits onde o script ainda está no
colo (~130-190 ms) e cold start real com o script evictado (~550-950 ms).

| métrica                          | esbuild (baseline) | rolldown (prebundled) |
| --------------------------------- | ------------------ | --------------------- |
| warm (mediana, n=60)              | 43.5 ms            | 45.2 ms               |
| cluster quente (~130-190 ms)      | 5/12 hits          | 7/12 hits             |
| cluster frio (~550-950 ms)        | 7/12 hits, média **695 ms** | 5/12 hits, média **710 ms** |

Amostras brutas — esbuild: `688, 131, 577, 754, 189, 607, 955, 177, 733, 171, 135, 611` | rolldown: `840, 715, 183, 130, 554, 140, 169, 140, 825, 130, 184, 615`

Conclusões do teste de fogo:
- **Dentro do cluster frio, não há diferença mensurável** (695 vs 710 ms): a essa escala, o cold start é dominado pela carga do script/colo — a redução de 15% de tamanho do rolldown se perde na variância.
- **A escala é o que importa**: o cold start real saltou de ~130-170 ms (92-782 KB) pra ~550-950 ms (~5 MB). Reduzir o bundle em MB vale muito; otimizar os últimos 15% vale pouco.
- **O wrangler padrão nem empacota o mega**: pngjs/gifwrap (via jimp) fazem `require("fs")` nu em CJS, que o esbuild não stuba (só `node:*` em ESM). Com stubs (nosso script) os dois bundlers empacotam e o worker roda sem `nodejs_compat`.
- Warm segue idêntico (43.5 vs 45.2 ms) mesmo com 5 MB: execução não depende do tamanho do bundle.

Observações:
- O padrão pesado teve pior cauda (max 298 ms) — bundle maior ⇒ mais variação de parse/compile.
- O ganho relativo do pesado (13%) é menor que o do leve (20%): o moment entra inteiro nos dois bundles e dilui a diferença relativa de tamanho.
- Ambas as medições têm ruído de rota/colo; a direção é consistente: prebundled venceu em 10 de 14 cold samples.

## Por que isso importa pra cold start

Em Workers, cold start = carregar o script + parse/compilar no V8 (isolate). O custo de parse é dominado pelo tamanho **raw** do script. O gzip só ajuda no upload (limite de 10 MB comprimido no free plan).

Detalhe importante: `wrangler deploy` **já usa esbuild internamente** pra empacotar `src/*.ts`. Então pré-bundlar com esbuild no Workers é redundante (mesmo resultado). O ganho vem do rolldown (tree-shaking estilo rollup), não do ato de bundlar.

## O que o pre-bundle de qualidade exigiu (notas técnicas)

Bundlar código realista pra Workers (axios/@aws-sdk) não é só `rolldown({input})`:

1. **Builtins do Node** (`stream`, `crypto`, `zlib`, `http2`...): stub via plugin — cada módulo vira no-op com named exports + default (atende `import { X }`, `import mod from` e `require()`). Alguns precisam de exports-objeto (`zlib.constants`).
2. **Campo `browser` como mapa de substituição**: `aliasFields: [["browser"]]` — o @aws-sdk troca `runtimeConfig` → `runtimeConfig.browser`; sem isso o bundle puxa o config de Node (e cresce de 446 KB pra 630 KB + quebra em runtime).
3. **Shim de `process`**: libs acessam `process.version` etc. como global. Sem `var` (colide com o minificador): atribuir em `globalThis.process` basta — propriedades de globalThis viram globals.
4. **Shim de `Buffer` mínimo** (class estendendo Uint8Array com write/read UInt*): exceljs/jimp usam `instanceof Buffer`, `Buffer.alloc`, `writeUInt32BE` no init. Via IIFE no banner pra não colidir com o minificador.
5. **`inlineDynamicImports`** (ou `codeSplitting: false`) pra saída de arquivo único — Workers com `no_bundle` exigem um só módulo.
6. **Exports-browser que são stubs vazios** (jimp): o pacote `jimp` tem `exports.browser` apontando pra um arquivo vazio. Solução: compor o jimp via `@jimp/*` (igual ao index oficial) em `src/jimp-shim.ts`.
7. **Esbuild não stuba `require("fs")` nu em CJS** (só `node:*` em ESM) — por isso o wrangler padrão não empacota o mega; nosso plugin de stub cobre os dois bundlers.

## Como rodar

```bash
npm install
npm run bundle       # gera dist/rolldown e dist/esbuild (leve + pesado + mega)
npm run compare      # tabela de tamanhos + parse time (proxy de cold start)

# testar localmente
npm run dev                                          # leve, padrao
npx wrangler dev -c wrangler.prebundled.toml          # leve, pre-bundle rolldown
npx wrangler dev -c wrangler.heavy-prebundled.toml    # pesado, pre-bundle rolldown
npx wrangler dev -c wrangler.mega-prebundled.toml     # mega, pre-bundle rolldown
npx wrangler dev -c wrangler.mega-esbuild.toml        # mega, esbuild (baseline)

# deploy na Cloudflare
npm run deploy                      # leve padrao
npm run deploy:prebundled           # leve rolldown
npm run deploy:heavy                # pesado padrao
npm run deploy:heavy:prebundled     # pesado rolldown
npx wrangler deploy -c wrangler.mega-esbuild.toml      # mega esbuild (baseline)
npx wrangler deploy -c wrangler.mega-prebundled.toml   # mega rolldown

# medir TTFB (rode apos deixar o Worker ocioso ~75-90s)
node scripts/bench.mjs <url-a> <url-b> [warm_requests]
node scripts/cold-sample.mjs <url-a> <url-b> [wait_s] [rounds]
```

## Arquivos

- `src/index.ts` — Worker leve (zod + date-fns + lodash-es)
- `src/heavy.ts` — Worker pesado (+ @aws-sdk/client-s3, moment, axios, i18next)
- `src/mega.ts` — Worker mega (+ exceljs, pdf-lib, cheerio, highlight.js, three, jimp, openai, @anthropic-ai/sdk, luxon, lodash)
- `src/jimp-shim.ts` — composição do jimp via `@jimp/*` (o pacote `jimp` tem stub vazio no exports.browser)
- `scripts/build.mjs` — gera bundles rolldown e esbuild (com stubs de builtins, campo browser, shims de process/Buffer)
- `scripts/compare.mjs` — comparativo de tamanho e parse time
- `scripts/bench.mjs` — warm TTFB intercalado (2 URLs)
- `scripts/cold-sample.mjs` — amostra cold starts com ócio programado
- `wrangler*.toml` — configs: padrão (esbuild interno) vs pre-bundle (`no_bundle = true`)

## Limitações da medição

- TTFB externo mistura rota CF + spawn de isolate + parse + execução; não isola só o parse.
- Free plan: colos e eviction variam; amostras têm ruído (no leve, 1 de 14 rodadas o padrão foi mais rápido).
- No mega (~5 MB), o TTFB ficou bimodal (script no colo vs evictado) — comparar medianas totais engana; separamos por cluster.
- O proxy mais determinístico continua sendo tamanho do script + parse time local (`npm run compare`).
- No dashboard: Workers & Pages → seu Worker → Metrics mostra CPU time; `wrangler tail` mostra duração por request.
