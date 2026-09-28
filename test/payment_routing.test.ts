import assert from "node:assert/strict";
import test from "node:test";
import type { RoutingChoice, RoutingClient } from "../src/infrai_routing_client.js";
import { PaymentRiskService } from "../src/payment_risk_service.js";

test("a high-risk payment excludes one provider once", async () => {
  const writes: RoutingChoice[] = [];
  const routing: RoutingClient = {
    async setRouting(choice) {
      writes.push(choice);
      return { applied: true };
    }
  };
  const service = new PaymentRiskService(routing, 80);
  const event = {
    event_id: "evt_1042",
    payment_id: "pay_771",
    amount_usd: 420,
    risk_score: 91,
    capability: "payment-notifications",
    provider_to_exclude: "vendor-red"
  };

  const first = await service.decide(event);
  const replay = await service.decide(event);

  assert.deepEqual(writes, [{
    capability: "payment-notifications",
    exclude: ["vendor-red"]
  }]);
  assert.equal(first.decision, "provider_excluded");
  assert.equal(first.excluded_provider, "vendor-red");
  assert.deepEqual(replay, first);
});

test("a lower-risk payment leaves routing untouched", async () => {
  const routing: RoutingClient = {
    async setRouting() {
      assert.fail("routing must not change");
    }
  };
  const service = new PaymentRiskService(routing, 80);

  const result = await service.decide({
    event_id: "evt_1043",
    payment_id: "pay_772",
    amount_usd: 28,
    risk_score: 32,
    capability: "payment-notifications",
    provider_to_exclude: "vendor-red"
  });

  assert.equal(result.decision, "routing_unchanged");
  assert.equal(result.excluded_provider, null);
});
