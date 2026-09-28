import { z } from "zod";
import type { RoutingClient } from "./infrai_routing_client.js";

export const paymentEventSchema = z.object({
  event_id: z.string().min(1),
  payment_id: z.string().min(1),
  amount_usd: z.number().positive(),
  risk_score: z.number().min(0).max(100),
  capability: z.string().min(1),
  provider_to_exclude: z.string().min(1)
}).strict();

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export type AuditNotification = {
  event_id: string;
  payment_id: string;
  decision: "provider_excluded" | "routing_unchanged";
  capability: string;
  excluded_provider: string | null;
  reason: string;
};

export class PaymentRiskService {
  private readonly decisions = new Map<string, Promise<AuditNotification>>();
  private readonly routing: RoutingClient;
  private readonly exclusionThreshold: number;

  constructor(
    routing: RoutingClient,
    exclusionThreshold = 80
  ) {
    this.routing = routing;
    this.exclusionThreshold = exclusionThreshold;
  }

  decide(event: PaymentEvent): Promise<AuditNotification> {
    const prior = this.decisions.get(event.event_id);
    if (prior) return prior;

    const decision = this.applyDecision(event);
    this.decisions.set(event.event_id, decision);
    decision.catch(() => this.decisions.delete(event.event_id));
    return decision;
  }

  private async applyDecision(event: PaymentEvent): Promise<AuditNotification> {
    if (event.risk_score < this.exclusionThreshold) {
      return {
        event_id: event.event_id,
        payment_id: event.payment_id,
        decision: "routing_unchanged",
        capability: event.capability,
        excluded_provider: null,
        reason: `risk score below ${this.exclusionThreshold}`
      };
    }

    await this.routing.setRouting({
      capability: event.capability,
      exclude: [event.provider_to_exclude]
    });

    return {
      event_id: event.event_id,
      payment_id: event.payment_id,
      decision: "provider_excluded",
      capability: event.capability,
      excluded_provider: event.provider_to_exclude,
      reason: `risk score at or above ${this.exclusionThreshold}`
    };
  }
}
