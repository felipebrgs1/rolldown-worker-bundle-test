import { rolldown } from "rolldown";
import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

mkdirSync("dist/rolldown", { recursive: true });
mkdirSync("dist/esbuild", { recursive: true });

const format = "esm"; // module worker

const targets = [
  // worker leve: deps "puras" de browser, platform neutral basta
  { input: "src/index.ts", name: "worker", neutral: true },
  // worker pesado: axios/@aws-sdk importam builtins do Node -> condicoes browser
  { input: "src/heavy.ts", name: "heavy", neutral: false },
  // teste de fogo: exceljs/pdf-lib/three/jimp/openai/...
  { input: "src/mega.ts", name: "mega", neutral: false },
];

// ============================================================================
// Stubs pra builtins do Node (equivalente ao esbuild platform:browser e ao
// wrangler sem nodejs_compat): named imports viram no-ops, objetos e funcoes.
// ============================================================================
const stubExports = {
  stream: "Readable,Writable,Transform,PassThrough,Duplex,pipeline,Stream,ReadStream",
  http: "ClientRequest,IncomingMessage,RequestOptions,Agent,request,release",
  https: "ClientRequest,IncomingMessage,RequestOptions,Agent,request,release,hAgent,hAgentOptions,hAgentType,hsAgent,hsAgentOptions,hsAgentType",
  crypto: "createHash,createHmac,createPrivateKey,createPublicKey,randomBytes,randomUUID,sign,getRandomValues",
  util: "promisify,inspect,format,deprecate,inherits",
  path: "join,sep,resolve,dirname,basename,extname",
  fs: "readFileSync,lstatSync,fstatSync,createReadStream,createWriteStream,promises,existsSync",
  "fs/promises": "fsPromises",
  os: "homedir,platform,cpus,tmpdir,EOL",
  zlib: "gzip,gunzip,deflate,inflate,createGzip,createGunzip,createUnzip,createBrotliDecompress,createZstdDecompress,createBrotliCompress,createZstdCompress",
  process: "versions,env,cwd,platform,nextTick",
  events: "EventEmitter,once",
  buffer: "Buffer",
  url: "URL,URLSearchParams",
  tty: "isatty",
  assert: "ok,equal,deepEqual,strictEqual",
  http2: "connect,createServer",
  net: "Server,connect,createServer",
  tls: "Server,connect",
  child_process: "exec,spawn,execSync,spawnSync",
  string_decoder: "StringDecoder",
  querystring: "stringify,parse",
};

// exports que precisam ser objetos (nao funcoes)
const stubObjects = {
  zlib: { constants: "Z_SYNC_FLUSH,BROTLI_OPERATION_FLUSH,ZSTD_e_flush" },
};

const bareBuiltins = [
  ...Object.keys(stubExports),
  // demais builtins do node: stub com default vazio
  "v8", "vm", "worker_threads", "cluster", "dgram", "dns", "domain", "inspector", "module", "perf_hooks", "punycode", "readline", "repl", "sys", "timers", "trace_events", "wasi", "async_hooks", "console", "constants", "diagnostics_channel", "freelist",
];
const nodeBuiltins = new Set();
for (const b of bareBuiltins) {
  nodeBuiltins.add(b);
  nodeBuiltins.add(`node:${b}`);
}

function stubContent(name) {
  const names = stubExports[name] ?? "";
  const list = names.split(",").map((n) => n.trim()).filter(Boolean);
  const body = list
    .map((n) => `const ${n} = typeof globalThis !== "undefined" && globalThis.${n} !== undefined ? globalThis.${n} : function() {};`)
    .join("\n");
  const objs = stubObjects[name] ?? {};
  const objBody = Object.entries(objs)
    .map(([n, keys]) => `const ${n} = { ${keys.split(",").map((k) => `${k.trim()}: 0`).join(", ")} };`)
    .join("\n");
  const all = [...list, ...Object.keys(objs)];
  // default = objeto com todos os nomes: atende `import mod from "zlib"`,
  // `require("stream")` (interop CJS) e named imports ESM
  return `${body}\n${objBody}\nexport { ${all.join(", ")} };\nexport default { ${all.join(", ")} };`;
}

// ---- plugin rolldown ----
const rolldownStubPlugin = {
  name: "node-builtin-stub",
  resolveId(id) {
    if (nodeBuiltins.has(id)) return "\0node-stub:" + id;
  },
  load(id) {
    const m = id.match(/^\0node-stub:(?:node:)?([a-z_0-9/]+)$/);
    if (!m) return null;
    return stubContent(m[1]);
  },
};

// ---- plugin esbuild (stuba builtins ate em require()) ----
const esbuildStubPlugin = {
  name: "node-builtin-stub",
  setup(b) {
    b.onResolve({ filter: /^(node:)?(stream|http|https|crypto|util|path|fs|os|zlib|process|events|buffer|url|tty|assert|http2|net|tls|child_process|string_decoder|querystring|v8|vm|worker_threads|cluster|dgram|dns|domain|inspector|module|perf_hooks|punycode|readline|repl|sys|timers|trace_events|wasi|async_hooks|console|constants|diagnostics_channel|freelist)(\/promises)?$/ }, (args) => {
      const name = args.path.replace(/^node:/, "");
      return { path: name, namespace: "node-stub" };
    });
    b.onLoad({ filter: /.*/, namespace: "node-stub" }, (args) => ({
      contents: stubContent(args.path),
      loader: "js",
    }));
  },
};

// shim de process/global igual ao que o esbuild injeta em platform:browser.
// Sem `var`: propriedades de globalThis viram globals, evitando colisao de
// nomes com o minificador.
const globalShimBanner =
  'globalThis.process || (globalThis.process = { env: {}, version: "", platform: "browser", argv: [], cwd: function () { return "/"; }, nextTick: function (f) { queueMicrotask(f); } });' +
  "\nglobalThis.global = globalThis;" +
  // Buffer minimo (exceljs/jimp fazem instanceof/from no init). IIFE evita
  // colisao de nomes quando o banner passa pelo minificador.
  "\n(function () { if (globalThis.Buffer) return; class Buffer extends Uint8Array { static from(v) { if (v instanceof Uint8Array) return new this(v); if (typeof v === \"string\") return new this(new TextEncoder().encode(v)); return new this(v || []); } static alloc(n) { return new this(n); } static concat(list) { const n = list.reduce(function (s, x) { return s + x.length; }, 0); const r = new this(n); let o = 0; for (const x of list) { r.set(x, o); o += x.length; } return r; } static isBuffer(v) { return v instanceof this; } writeUInt32BE(v, o) { o = o || 0; new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(o, v, false); return o + 4; } writeUInt32LE(v, o) { o = o || 0; new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(o, v, true); return o + 4; } writeUInt16BE(v, o) { o = o || 0; new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(o, v, false); return o + 2; } writeUInt16LE(v, o) { o = o || 0; new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(o, v, true); return o + 2; } writeUInt8(v, o) { o = o || 0; new DataView(this.buffer, this.byteOffset, this.byteLength).setUint8(o, v); return o + 1; } readUInt32BE(o) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(o || 0, false); } readUInt32LE(o) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(o || 0, true); } readUInt16BE(o) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(o || 0, false); } readUInt16LE(o) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(o || 0, true); } readUInt8(o) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint8(o || 0); } toString() { return new TextDecoder().decode(this); } } globalThis.Buffer = Buffer; })();";

// ---- rolldown ----
for (const t of targets) {
  const bundle = await rolldown({
    input: t.input,
    platform: "neutral",
    treeshake: true,
    plugins: [rolldownStubPlugin],
    resolve: {
      mainFields: t.neutral ? ["module", "main"] : ["browser", "module", "main"],
      // campo browser como mapa de substituicao (ex: @aws-sdk troca
      // runtimeConfig -> runtimeConfig.browser)
      aliasFields: t.neutral ? [] : [["browser"]],
      conditionNames: t.neutral ? [] : ["worker", "browser", "import", "module", "default"],
    },
  });
  await bundle.write({
    dir: "dist/rolldown",
    format,
    minify: true,
    inlineDynamicImports: true,
    entryFileNames: `${t.name}.js`,
    banner: globalShimBanner,
  });
  await bundle.close();
}

// ---- esbuild ----
for (const t of targets) {
  await build({
    entryPoints: [t.input],
    bundle: true,
    minify: true,
    treeShaking: true,
    format,
    platform: t.neutral ? "neutral" : "browser",
    mainFields: t.neutral ? ["module", "main"] : ["browser", "module", "main"],
    conditions: t.neutral ? undefined : ["worker", "browser", "import", "module", "default"],
    plugins: [esbuildStubPlugin],
    // imports dinamicos de builtins (ex: @anthropic-ai/sdk) ficam externos;
    // so executam em paths de credenciais que nao usamos no Workers
    external: ["node:*"],
    outfile: `dist/esbuild/${t.name}.js`,
    banner: { js: globalShimBanner },
    logLevel: "info",
  });
}

for (const t of targets) {
  for (const p of [`dist/rolldown/${t.name}.js`, `dist/esbuild/${t.name}.js`]) {
    const buf = readFileSync(p);
    console.log(`\n${p}`);
    console.log(`  raw: ${buf.length} bytes | gzip: ${gzipSync(buf, { level: 9 }).length} bytes`);
    console.log(`  prefixo: ${buf.toString("utf8").slice(0, 80)}...`);
  }
}
