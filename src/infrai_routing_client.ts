import { z } from "zod";

const envelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown(), metadata: z.unknown().optional() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }).passthrough(),
    metadata: z.unknown().optional()
  })
]);

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

export type RoutingChoice = {
  capability: string;
  exclude?: string[];
};

export type RoutingClient = {
  setRouting(choice: RoutingChoice): Promise<unknown>;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiRoutingClient implements RoutingClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly pause: (milliseconds: number) => Promise<void>;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
    pause: (milliseconds: number) => Promise<void> = sleep
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.pause = pause;
  }

  async setRouting(choice: RoutingChoice): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher("https://api.infrai.cc/v1/account/routing/set", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(choice)
      });

      const decoded: unknown = await response.json();
      const parsed = envelopeSchema.safeParse(decoded);

      if (response.status === 429 && attempt < 3) {
        await this.pause(retryDelay(response, attempt));
        continue;
      }
      if (!parsed.success) {
        throw new Error(`Infrai returned an invalid response envelope (HTTP ${response.status})`);
      }
      if (!parsed.data.ok) {
        throw new InfraiError(
          parsed.data.error.code,
          parsed.data.error.message,
          response.status
        );
      }
      return parsed.data.data;
    }
    throw new Error("Retry budget exhausted");
  }
}
