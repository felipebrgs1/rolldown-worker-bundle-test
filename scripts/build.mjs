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
];

// stubs pra builtins do Node (mesmo comportamento do esbuild platform:browser
// e do wrangler sem nodejs_compat): todos os named imports viram no-ops.
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
  "http2": "connect,createServer",
  net: "Server,connect,createServer",
  tls: "Server,connect",
  child_process: "exec,spawn,execSync,spawnSync",
  string_decoder: "StringDecoder",
  querystring: "stringify,parse",
};

const stubObjects = {
  // exports que precisam ser objetos (nao funcoes)
  zlib: { constants: "Z_SYNC_FLUSH,BROTLI_OPERATION_FLUSH,ZSTD_e_flush" },
};
const bareBuiltins = [
  ...Object.keys(stubExports),
  // demais builtins do node: default-only stub
  "http2", "v8", "vm", "worker_threads", "cluster", "dgram", "dns", "domain", "inspector", "module", "perf_hooks", "punycode", "readline", "repl", "sys", "timers", "trace_events", "wasi", "async_hooks", "console", "constants", "diagnostics_channel", "freelist",
];
const nodeBuiltins = new Set();
for (const b of bareBuiltins) {
  nodeBuiltins.add(b);
  nodeBuiltins.add(`node:${b}`);
}
const stubPlugin = {
  name: "node-builtin-stub",
  resolveId(id) {
    if (nodeBuiltins.has(id)) return "\0node-stub:" + id;
  },
  load(id) {
    const m = id.match(/^\0node-stub:(?:node:)?([a-z_0-9/]+)$/);
    if (!m) return null;
    const names = stubExports[m[1]] ?? "";
    const list = names.split(",").map((n) => n.trim()).filter(Boolean);
    const body = list
      .map((n) => `const ${n} = typeof globalThis !== "undefined" && globalThis.${n} !== undefined ? globalThis.${n} : function() {};`)
      .join("\n");
    const objs = stubObjects[m[1]] ?? {};
    const objBody = Object.entries(objs)
      .map(([n, keys]) => `const ${n} = { ${keys.split(",").map((k) => `${k.trim()}: 0`).join(", ")} };`)
      .join("\n");
    const all = [...list, ...Object.keys(objs)];
    // default = objeto com todos os nomes: atende `import mod from "zlib"`,
    // `require("stream")` (interop CJS) e named imports ESM
    return `${body}\n${objBody}\nexport { ${all.join(", ")} };\nexport default { ${all.join(", ")} };`;
  },
};

// ---- rolldown ----
for (const t of targets) {
  const bundle = await rolldown({
    input: t.input,
    platform: "neutral",
    treeshake: true,
    plugins: [stubPlugin],
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
    // shims iguais aos que o esbuild injeta em platform:browser (e o wrangler usa).
    // Sem var: propriedades de globalThis viram globals, evitando colisao de
    // nomes com o minificador.
    banner:
      'globalThis.process || (globalThis.process = { env: {}, version: "", platform: "browser", argv: [], cwd: function () { return "/"; }, nextTick: function (f) { queueMicrotask(f); } });' +
      "\nglobalThis.global = globalThis;",
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
    outfile: `dist/esbuild/${t.name}.js`,
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
