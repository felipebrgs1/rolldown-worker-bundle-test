import { z } from "zod";
import { formatDistance, formatISO, parseISO, addDays, differenceInDays } from "date-fns";
import { chunk, uniqBy, sortBy, groupBy } from "lodash-es";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import moment from "moment";
import axios from "axios";
import i18next from "i18next";

const Env = z.object({
  GREETING: z.string().default("Hello"),
  APP_NAME: z.string().default("rolldown-test"),
});

// client S3 (R2) — tipico em Workers
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

export default {
  async fetch(request: Request, env: unknown, _ctx: ExecutionContext) {
    const parsed = Env.parse(env);

    // uso real das deps
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

    // moment (nao faz tree-shake — import default puxa tudo)
    const momentStr = moment().add(2, "days").format("YYYY-MM-DD");

    // axios (so cria a instancia, nao chama rede)
    const axiosClient = axios.create({ baseURL: "https://example.com", timeout: 1000 });

    // S3: prepara comandos (nao executa)
    const listCmd = new ListObjectsV2Command({ Bucket: "test-bucket" });
    const getCmd = new GetObjectCommand({ Bucket: "test-bucket", Key: "file.txt" });

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
      });
    }

    return Response.json({
      message: `${parsed.GREETING} from ${parsed.APP_NAME}`,
      nextWeek,
    });
  },
} satisfies ExportedHandler<z.infer<typeof Env>>;
