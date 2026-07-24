# Invoice Service

Bindings for the Emporix **Invoice Service** (`/invoice/{tenant}/…`): create
invoice-generation jobs for orders and poll their status.

> **Server-side only.** The endpoints require a backend `invoice.*` scope,
> served by the **service (clientCredentials) token**. Never call these from a
> browser. Every method defaults its trailing `auth` to the service credential
> set.

## Creating a job — `client.invoices`

A job either processes an explicit list of order ids (`MANUAL`) or lets the
service find eligible orders from the tenant configuration (`AUTOMATIC`).

```ts
// MANUAL: invoice these specific orders
const { jobId } = await client.invoices.createJob({
  jobType: "MANUAL",
  orderIds: ["order-1", "order-2"],
});

// AUTOMATIC: the service selects orders per configuration
const auto = await client.invoices.createJob({ jobType: "AUTOMATIC" });
```

## Polling a job

`getJob` returns the job status plus a per-order result list (with the invoice
number and a download link once processed).

```ts
let job = await client.invoices.getJob(jobId!);
while (job.jobStatus === "IN_PROGRESS") {
  await new Promise((r) => setTimeout(r, 2000));
  job = await client.invoices.getJob(jobId!);
}
for (const o of job.orders ?? []) {
  console.log(o.orderId, o.orderStatus, o.invoiceNumber, o.downloadLink);
}
```

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
