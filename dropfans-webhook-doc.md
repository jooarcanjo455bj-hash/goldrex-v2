> ## Documentation Index
> Fetch the complete documentation index at: https://www.dropfans.io/developers/llms.txt
> Use this file to discover all available pages before exploring further.

# Webhooks & polling

> Signed webhooks tell your app about sales, refunds, payouts and ID-check results as they happen; polling endpoints cover the same ground as a fallback.

- Source: https://www.dropfans.io/developers/webhooks/overview
- Section: Webhooks
- OpenAPI: https://www.dropfans.io/developers/openapi.json

Webhooks are per **app**. Set one https endpoint for your app with [PUT /api/external/v1/webhooks](https://www.dropfans.io/developers/reference/set-webhook.md) using a key your app owner holds (their own, or one their agency minted for its personas). Events about every creator who holds a key for your app (and every account you [created](https://www.dropfans.io/developers/reference/create-account.md)) are then POSTed to it.

**Agencies.** If your app holds an [agency’s own key](https://www.dropfans.io/developers/concepts/agencies.md), you also receive the events of every creator and AI persona that agency manages (accepted management). Those payloads carry `data.agencyId` (the agency) in addition to `data.accountId` (the creator), so one endpoint can route the whole roster. An app is never sent the same event twice — if it also holds that creator’s own key, it gets one delivery, without `agencyId`.

## Events

| Event | Fires when | `data` |
| --- | --- | --- |
| `drop.paid` | a buyer completes checkout on a drop | an [Order](https://www.dropfans.io/developers/reference/list-orders.md), including your per-fan `externalRef` |
| `drop.refunded` | a paid drop order is refunded or charged back | the Order plus `refundedAt` and `reason` (`refund` or `chargeback`) |
| `tip.paid` | a fan's tip settles | a [Tip](https://www.dropfans.io/developers/reference/list-tips.md), including your per-fan `externalRef` and the fan's `message` |
| `tip.refunded` | a paid tip is refunded or charged back | the Tip plus `refundedAt` and `reason` (`refund` or `chargeback`) |
| `subscription.paid` | a subscription charge is booked — the first charge and every renewal — and once when a free trial starts | a subscription charge (see below) |
| `subscription.canceled` | renewal is turned off; the fan keeps access until `accessUntil` | `subscriptionId`, `accountId`, `canceledAt`, `accessUntil`, `canceledBy` (`subscriber`, `creator` (the creator blocked the fan), `support`, `processor`, `account_deleted`), `subscriber` |
| `subscription.ended` | access ends | `subscriptionId`, `accountId`, `endedAt`, `reason` (`expired`, `ended_by_support`, `refunded`, `account_deleted`), `subscriber` |
| `account.kyc_updated` | an account you created moves through the ID check | `accountId`, `username`, `kycStatus` (`in_review`, `approved`, `declined`), `sellerStatus` |
| `payout.requested` | the account requests a payout (dashboard or [API](https://www.dropfans.io/developers/reference/create-payout-request.md)) — one event per side | a [Payout](https://www.dropfans.io/developers/reference/get-payout.md) row, `kind: "request"`, plus `accountId` |
| `payout.processing` | a payout is sent to the provider | a Payout row (`kind: "payout"`) plus `accountId` |
| `payout.paid` | a payout is paid (sent and confirmed, settled by an admin, or recorded as a manual payout) | a Payout row (`kind` `payout` or `manual`; `requestId` names the request it fulfilled) plus `accountId` |
| `payout.failed` | a payout fails at the provider, or a payout request is rejected | a Payout row (`status` `failed` or `rejected`) plus `accountId` |
| `ping` | you call [POST /webhooks/test](https://www.dropfans.io/developers/reference/test-webhook.md) | `message` |

### Subscription events

`subscription.paid` carries one charge: `subscriptionId`, `accountId` (the creator), `chargeId`, `transactionId`, `kind` (`trial_start`, `first_charge`, `renewal`), `trial`, `amountCents`, `netAmountCents`, `taxCents`, `currency`, `paidAt`, `periodEnd` (access runs until then), `trialEndsAt`, `paidWith` (`card` or `credits`) and `subscriber` (`id`, `email`, `telegramUserId`, `telegramUsername`). A trial start has `kind: "trial_start"`, `trial: true` and `amountCents: 0`; the first paying charge follows as its own `subscription.paid`. `transactionId` is unique per charge (the processor’s id, or the credits debit), so dedupe charges on it. It, `chargeId`, `netAmountCents` and `taxCents` are `null` on a first charge we hear about before its payment record; a trial start has no `transactionId` either. `subscriptionId` stays the same across renewals.

A fan who cancels sends `subscription.canceled` at once and `subscription.ended` when the paid time runs out. Support ending a subscription now, a refund or a deleted account send both together. Free tiers send none of these.

### Payout events

`data` is exactly what [GET /api/external/v1/payouts/{id}](https://www.dropfans.io/developers/reference/get-payout.md) returns for that row, as it is when the event is sent, plus `accountId`; money in integer cents, destinations masked. Each transition is sent once; a payout that an admin retries reports `payout.processing` (and then `payout.paid` or `payout.failed`) again for its new attempt. A request that is paid is followed by `payout.paid` for the payout that fulfilled it — match them with `requestId`. Requests cancelled by the account send no event.

Apps that know an account through an [agency’s own key](https://www.dropfans.io/developers/concepts/agencies.md) only receive its payout events when the agency holds `canViewStats` on it. Apps whose webhook has no event filter (the default: everything) receive these new events automatically — ignore types you do not handle.

## Envelope

Every delivery is a JSON `POST`:

```json
{
  "id": "evt_2b7c91d0e4a5f6b7c8d9e0f1",
  "type": "drop.paid",
  "created": "2026-10-17T16:20:01.000Z",
  "data": {
    "orderId": "clxor0001order",
    "productId": "clxdr0p000001prod",
    "accountId": "clx2f8a1b0001qw3k",
    "externalRef": "tg_48213377",
    "amountCents": 2750,
    "currency": "USD",
    "paidAt": "2026-10-17T16:20:00.000Z",
    "paidWith": "card",
    "status": "paid",
    "buyer": { "id": "clxbu0001buyer", "email": "buyer@example.com", "telegramUserId": "48213377", "telegramUsername": "fan_one" }
  }
}
```

Headers:

| Header | Value |
| --- | --- |
| `DropFans-Event-Id` | the event id (same as `id`) — dedupe on it |
| `DropFans-Event` | the event type |
| `DropFans-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |

## Verify the signature

The signature is an HMAC-SHA256, keyed with your `whsec_…` secret, over `<t>.<raw request body>`. Compute it on the **raw** bytes, before any JSON parsing. Compare in constant time, and reject timestamps more than 5 minutes old.

```javascript tab="Node"
import crypto from 'node:crypto';

export function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

```python tab="Python"
import hashlib, hmac, time

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts.get("t", 0))
    if not t or abs(time.time() - t) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## Delivery and retries

- Answer any **2xx** within 5 seconds to acknowledge. Do the work afterwards (queue it). Redirects are not followed.
- Anything else is retried with backoff (about 1 min, 5 min, 15 min, 1 h, 3 h, then every 6 h), up to 8 attempts in total. After that the event is marked failed.
- Events can arrive more than once and out of order. Dedupe on `DropFans-Event-Id` (or on `orderId` for sales, `transactionId` for subscription charges).
- [GET /api/external/v1/webhooks](https://www.dropfans.io/developers/reference/get-webhook.md) shows your last 20 deliveries with status codes and errors.

## Polling (fallback)

Webhooks can be missed if your endpoint is down for longer than the retry window. Keep a slow sweep as a safety net and budget it against your [rate tier](https://www.dropfans.io/developers/concepts/rate-limits.md): 5,000 requests a day (personal) and 50,000 per key (app).

### 1. Sales — orders and check-status

[GET /api/external/v1/orders](https://www.dropfans.io/developers/reference/list-orders.md) with `since` = your last sweep returns every paid order with its `externalRef`. [POST /drops/check-status](https://www.dropfans.io/developers/reference/check-drop-status.md) (up to 200 product ids per call) does the same per product. With webhooks on, one sweep every 15–60 minutes is plenty.

### 2. Video processing — video-status

While a video is processing after [upload](https://www.dropfans.io/developers/guides/upload-media.md), poll [POST /vault/video-status](https://www.dropfans.io/developers/reference/video-status.md) (up to 50 ids) every 10–15 seconds until `isReady` or `isFailed`.

### 3. Moderation — posts and vault

- Posts: [GET /posts?status=PENDING](https://www.dropfans.io/developers/reference/list-posts.md) or [GET /posts/{id}](https://www.dropfans.io/developers/reference/get-post.md) every 30–60 seconds while something is pending.
- Vault items: [GET /vault?includePending=true](https://www.dropfans.io/developers/reference/list-vault.md) every few minutes after a batch upload, until nothing is PENDING.

Next: [Broadcast one drop to many fans](https://www.dropfans.io/developers/guides/broadcast-one-drop.md) or [Creator sign-up from your platform](https://www.dropfans.io/developers/guides/creator-signup.md).

---

Previous: [Build your own CRM dashboard](https://www.dropfans.io/developers/guides/crm-dashboard.md) · Next: [Build with AI](https://www.dropfans.io/developers/build-with-ai/overview.md) · All pages: [llms.txt](https://www.dropfans.io/developers/llms.txt)
