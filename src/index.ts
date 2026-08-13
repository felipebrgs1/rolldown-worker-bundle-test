import { z } from "zod";
import { formatDistance, formatISO, parseISO, addDays, differenceInDays } from "date-fns";
import { chunk, uniqBy, sortBy, groupBy } from "lodash-es";

const Env = z.object({
  GREETING: z.string().default("Hello"),
  APP_NAME: z.string().default("rolldown-test"),
});

export default {
  async fetch(request: Request, env: unknown, _ctx: ExecutionContext) {
    const parsed = Env.parse(env);

    // uso real das deps (só pra simular um worker com trabalho de verdade)
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

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        chunks: chunks.length,
        groups: Object.keys(grouped).length,
        nextWeek,
        sinceJoin,
      });
    }

    return Response.json({
      message: `${parsed.GREETING} from ${parsed.APP_NAME}`,
      nextWeek,
    });
  },
} satisfies ExportedHandler<z.infer<typeof Env>>;
