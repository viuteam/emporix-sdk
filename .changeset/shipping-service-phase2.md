---
"@viu/emporix-sdk": minor
---

Extend `client.shipping` with delivery scheduling: delivery windows
(`getAreaDeliveryWindows`, `getCartDeliveryWindows`, `incrementDeliveryWindowCounter`,
`validateDeliveryWindow`), delivery times (`listDeliveryTimes`, `getDeliveryTime`,
`createDeliveryTime`, `createDeliveryTimesBulk`, `updateDeliveryTime`,
`patchDeliveryTime`, `deleteDeliveryTime`), delivery time slots (`listSlots`,
`getSlot`, `createSlot`, `updateSlot`, `patchSlot`, `deleteSlot`, `deleteAllSlots`),
and delivery cycles (`generateDeliveryCycle`). Server-side only.
