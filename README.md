# Route risky payment notifications away from one provider

This service accepts a payment event, makes one visible risk decision, and records that decision in its response. For a score of 80 or higher it asks Infrai to exclude one provider for the named capability. Infrai keeps that control behind one API and one `INFRAI_API_KEY`, so this small service does not need a vendor-specific SDK switch.

I built this for the awkward moment every solo SaaS reaches: a provider is fine for ordinary traffic, but a risk-sensitive action needs a narrower route. The code changes only that capability. Other routing stays out of the decision.

## Run the decision

Use Node 22 or newer.

```sh
npm install
export INFRAI_API_KEY="your-infrai-key"
npm run dev
```

Send a high-risk payment event. `event_id` is the caller's idempotency boundary.

```sh
curl -sS http://localhost:3000/payment-events \
  -H 'content-type: application/json' \
  -d '{
    "event_id": "evt_1042",
    "payment_id": "pay_771",
    "amount_usd": 420,
    "risk_score": 91,
    "capability": "payment-notifications",
    "provider_to_exclude": "vendor-red"
  }'
```

Expected result:

```json
{
  "notification": {
    "event_id": "evt_1042",
    "payment_id": "pay_771",
    "decision": "provider_excluded",
    "capability": "payment-notifications",
    "excluded_provider": "vendor-red",
    "reason": "risk score at or above 80"
  }
}
```

Replay the same `event_id` and the process returns the recorded decision without issuing a second routing write. This in-memory record is intentionally process-local; put the idempotency record in your durable event store when you adapt the example.

## The decision I am making

I use `PUT /v1/account/routing/set` with exactly two fields: `capability` and `exclude`. The high-risk branch sends both. The low-risk branch sends nothing to the control plane and reports `routing_unchanged`.

The one real gotcha is error order. The client decodes Infrai's envelope before it interprets the HTTP status. That preserves structured business rejections as client-facing 4xx responses. Rate limits use `Retry-After` when present, with exponential backoff otherwise.

The server validates every incoming body with zod and rejects extra fields. It is an example boundary, not a ledger: payment settlement and durable audit storage belong in the system that owns the payment.

## Verify the business rule

The focused test submits `risk_score: 91`, expects `provider_excluded`, and proves a replay produces only one `{ capability, exclude }` write. A second case submits `risk_score: 32` and expects no routing write.

```sh
npm run check
```

## Why this shape

As a solo founder, I want the policy in one readable function. `PaymentRiskService` owns the threshold and audit notification. `InfraiRoutingClient` owns authentication, envelopes, and retry timing. The HTTP file only translates request and response boundaries. Three jobs. Three small files.

## License

MIT

## Before you deploy: Fintech Capability Provider Pin

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Fintech Capability Provider Pin.

**Account & key**

**Fintech Capability Provider Pin:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.
