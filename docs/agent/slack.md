# Slack integration

Adex routes agent + ad lifecycle events through the existing Webhook subscription mechanism. To send them to Slack:

1. **Create a Slack incoming webhook**: in Slack, *Apps → Manage → Custom Integrations → Incoming WebHooks → Add Configuration*. Copy the URL — it will look like `https://hooks.slack.com/services/T.../B.../xxxx`.

2. **Register it in Adex**: in `/settings` → Webhooks tab, add a new subscription with that URL. Pick whichever events you want (recommended below). The HMAC secret Adex generates isn't actually verified by Slack, but Adex still signs the body for tamper-evidence.

3. **Adex auto-detects the URL**. When the subscriber URL matches `hooks.slack.com/services/...`, the webhook payload is rewritten into Slack's Block Kit shape via [src/lib/slack-payload.ts](../src/lib/slack-payload.ts). All other URLs receive the original `{event, orgId, data, timestamp}` JSON.

## Recommended event subscriptions

| Channel | Events | Why |
|---|---|---|
| `#adex-approvals` | `agent.approval.requested` | Notification on every pending approval |
| `#adex-incidents` | `agent.killswitch.activated`, `agent.decision.failed`, `ad.policy_rejected` | Page someone when bad things happen |
| `#adex-firehose` | `*` | Useful in dev / for an ops bot to consume |

## Payload shape

The Slack-shape payload always includes:

- `text` — fallback string for mobile previews (`[severity] headline (org orgId)`)
- `blocks[0]` — a section with `*Adex · {event}*\n{headline}`
- `blocks[1]` — fields with the most useful keys (`decisionId`, `campaignId`, `severity`, `mode`, `rationale`, …)
- `blocks[2]` — a button to `/approvals` or `/decisions` (uses `NEXT_PUBLIC_APP_URL` for the absolute URL)
- `blocks[3]` — a context line with `severity / org / color`

Adex still attaches its standard headers:
```
X-Adex-Event: agent.approval.requested
X-Adex-Signature: sha256=<hex of slack-shaped body>
X-Adex-Delivery: <uuid>
```

If Slack returns a non-2xx, the delivery is queued for exponential-backoff retry by `/api/cron/webhook-retry` exactly like any other webhook (see [runbook.md](./runbook.md)).

## Disabling Slack reformatting

If you really want Slack to receive the raw Adex JSON instead, host a thin proxy:

```
Slack-style URL → your proxy → POST hooks.slack.com/services/... with reshaped body
```

…and register the proxy URL with Adex instead of Slack's directly. The URL won't match the hostname check and Adex will deliver the raw JSON.
