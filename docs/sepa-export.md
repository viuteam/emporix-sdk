# SEPA Export Service

Bindings for the Emporix **SEPA Export Service** (`/sepa-export/{tenant}/…`):
export jobs and file retrieval.

> **Server-side.** Defaults to the service (clientCredentials) token
> (`sepaexport.job_*` / `sepaexport.media_view`).

```ts
const jobs = await client.sepaExport.listJobs();
const { id } = await client.sepaExport.createJob({ /* … */ });

// getFile returns the raw file content (SEPA XML) as a string
const xml = await client.sepaExport.getFile("file-id");
```

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
