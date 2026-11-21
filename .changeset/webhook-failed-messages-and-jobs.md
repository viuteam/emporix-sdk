---
"@viu/emporix-sdk": minor
---

feat(sdk): add webhook failed messages, jobs and delivery status

`client.webhooks` wraps the eight operations Emporix added for events it could not deliver. Once a target has failed 100 times in a row, the service switches it off and stores its events instead:

- `listFailedMessages` pages by number or by cursor (`nextCursor` / `prevCursor`) and filters by config, entry, event type, target type and `q`. `getFailedMessage` returns one message with its `payload`.
- `resendFailedMessage` queues one message again. `restartFailedMessages` starts a job for a selection, which you follow with `getJob` / `listJobs`.
- `deleteFailedMessage` and `deleteFailedMessages` drop messages without delivering them.

The selection of `restartFailedMessages` and `deleteFailedMessages` has no default, because an empty selection means every stored message.

`listConfigs` and `getConfig` now take `{ expand: "deliveryStatus" }`, which adds each delivery target's health. The original `listConfigs(auth)` and `getConfig(code, auth)` calls keep working. See `docs/webhook.md`.
