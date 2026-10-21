---
"@viu/emporix-mixins": patch
---

`schemaService({ types })` keeps the schemas of every listed entity type. It sent only the first one as the Schema Service's `type` filter, so the others were silently left out of the generated types.
