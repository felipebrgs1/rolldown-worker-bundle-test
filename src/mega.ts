import { z } from "zod";
import { formatDistance, formatISO, parseISO, addDays, differenceInDays } from "date-fns";
import { chunk, uniqBy, sortBy, groupBy } from "lodash-es";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import moment from "moment";
import axios from "axios";
import i18next from "i18next";

// ==== libs pesadas (teste de fogo) ====
import ExcelJS from "exceljs"; // gerar .xlsx no edge
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"; // gerar PDF no edge
import * as cheerio from "cheerio"; // parsing HTML (scraping)
import hljs from "highlight.js"; // syntax highlight (todos os idiomas)
import * as THREE from "three"; // matematica/cena 3D server-side
import { Jimp } from "./jimp-shim"; // processamento de imagem puro JS (composicao @jimp/*)
import OpenAI from "openai"; // AI
import Anthropic from "@anthropic-ai/sdk"; // AI
import { DateTime, Interval } from "luxon"; // datas/timezones
import _ from "lodash"; // CJS completo — zero tree-shaking, classico

const Env = z.object({
  GREETING: z.string().default("Hello"),
  APP_NAME: z.string().default("rolldown-test"),
});

// client S3 (R2)
const s3 = new S3Client({
  region: "auto",
  endpoint: "https://fake.r2.cloudflarestorage.com",
  credentials: { accessKeyId: "x", secretAccessKey: "y" },
});

await i18next.init({
  lng: "pt-BR",
  resources: {
    "pt-BR": { translation: { welcome: "Bem-vindo", goodbye: "Tchau" } },
    en: { translation: { welcome: "Welcome", goodbye: "Bye" } },
  },
});

// clientes de AI (so instanciam, nao chamam rede)
const openai = new OpenAI({ apiKey: "sk-test" });
const anthropic = new Anthropic({ apiKey: "sk-test" });

export default {
  async fetch(request: Request, env: unknown, _ctx: ExecutionContext) {
    const parsed = Env.parse(env);

    // ---- uso real das deps leves ----
    const ids = ["a", "b", "a", "c", "b", "d"];
    const users = [
      { id: "a", name: "Ana", joined: parseISO("2024-01-10") },
      { id: "b", name: "Bia", joined: parseISO("2024-06-01") },
      { id: "c", name: "Caio", joined: parseISO("2025-01-15") },
    ];
    const unique = uniqBy(users, "id");
    const sorted = sortBy(unique, (u) => u.joined);
    const grouped = groupBy(sorted, (u) => (differenceInDays(new Date(), u.joined) > 365 ? "old" : "new"));
    const chunks = chunk(ids, 2);
    const nextWeek = formatISO(addDays(new Date(), 7), { representation: "date" });
    const sinceJoin = formatDistance(users[0].joined, new Date(), { addSuffix: true });
    const momentStr = moment().add(2, "days").format("YYYY-MM-DD");
    const axiosClient = axios.create({ baseURL: "https://example.com", timeout: 1000 });
    const listCmd = new ListObjectsV2Command({ Bucket: "test-bucket" });
    const getCmd = new GetObjectCommand({ Bucket: "test-bucket", Key: "file.txt" });

    // ---- uso real das deps pesadas (objetos/preparacao, sem I/O) ----
    const wb = new ExcelJS.Workbook(); // workbook em memoria
    const ws = wb.addWorksheet("Relatorio");
    ws.addRow(["Nome", "Entrada"]);
    ws.addRows(users.map((u) => [u.name, formatISO(u.joined, { representation: "date" })]));

    const pdf = await PDFDocument.create(); // PDF em memoria
    const page = pdf.addPage([200, 100]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Hello from edge!", { x: 20, y: 60, size: 14, font, color: rgb(0.1, 0.2, 0.3) });

    const $ = cheerio.load("<div class='card'><h1>Titulo</h1><p>Conteudo</p></div>");
    const cardText = $(".card h1").text();

    const highlighted = hljs.highlight("const x = 42;", { language: "javascript" }).value;

    const scene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    scene.add(box);

    const img = new Jimp({ width: 8, height: 8, color: 0xff0000ff }); // 8x8 vermelho em memoria
    const pixelColor = img.getPixelColor(0, 0); // RGBA int
    const pixel = { r: (pixelColor >> 24) & 0xff, g: (pixelColor >> 16) & 0xff, b: (pixelColor >> 8) & 0xff, a: pixelColor & 0xff };

    const dt = DateTime.now().setZone("America/Sao_Paulo");
    const intervalo = Interval.fromDateTimes(dt.minus({ days: 30 }), dt).length("days");

    const lodashResult = _.chain(users)
      .sortBy((u) => u.joined)
      .groupBy((u) => (differenceInDays(new Date(), u.joined) > 365 ? "old" : "new"))
      .mapValues((g) => g.length)
      .value();

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        chunks: chunks.length,
        groups: Object.keys(grouped).length,
        nextWeek,
        sinceJoin,
        momentStr,
        t: i18next.t("welcome"),
        s3cmds: [listCmd.constructor.name, getCmd.constructor.name, axiosClient.defaults.timeout],
        excel: { sheets: wb.worksheets.length, rows: ws.rowCount },
        pdf: pdf.getPageCount(),
        cheerio: cardText,
        hljs: highlighted.slice(0, 40),
        three: scene.children.length,
        jimp: pixel,
        luxon: { tz: dt.zoneName, dias: intervalo },
        lodash: lodashResult,
        ai: [openai.baseURL, anthropic.baseURL],
      });
    }

    return Response.json({
      message: `${parsed.GREETING} from ${parsed.APP_NAME}`,
      nextWeek,
    });
  },
} satisfies ExportedHandler<z.infer<typeof Env>>;
