---
"@viu/emporix-sdk": minor
---

feat(sdk): send Content-Language on writes

Localized fields sent as maps of translations (`name: { de: "Stuhl", en: "Chair" }`)
now reach Emporix without a `fetch` override. Without a `Content-Language` header,
most services read localized fields as plain strings in the tenant's default
language and answer a map with a 400 — «localized values must be of String type
when the Content-Language header is not set to all languages».

- **`contentLanguage` in `EmporixConfig`** — sent as `Content-Language` on every
  request that carries a body, never on a `GET`: `"*"` for maps, a language code
  such as `"de"` for plain strings. Unset, nothing changes and no header is sent.
- **Per call on product and category writes** — `contentLanguage` in
  `ProductWriteOptions` (`create`, `update`, `replace`, `bulkCreate`, `bulkUpdate`)
  and in the new `CategoryWriteOptions` (`create`, `update`, `patch`) overrides the
  client default for that request.

The other writes with localized payloads — product templates, price models,
catalogs, brands, currencies and the rest — have no options argument and use the
client default. The template and price-model input types allow only maps, so those
writes need `contentLanguage: "*"`. `docs/products.md` shows how to send a single
call in another language through a second client that shares the token provider.
