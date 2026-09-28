import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, InfraiRoutingClient } from "./infrai_routing_client.js";
import { PaymentRiskService, paymentEventSchema } from "./payment_risk_service.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const port = Number(process.env.PORT ?? "3000");
const service = new PaymentRiskService(new InfraiRoutingClient(apiKey));

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/payment-events") {
    send(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const event = paymentEventSchema.parse(await readJson(request));
    const notification = await service.decide(event);
    send(response, 200, { notification });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: "invalid_payment_event" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, message: error.message });
      return;
    }
    send(response, 502, { error: "routing_request_failed" });
  }
});

server.listen(port, () => {
  console.log(`Payment risk service listening on http://localhost:${port}`);
});
