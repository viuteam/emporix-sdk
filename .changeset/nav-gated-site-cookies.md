---
"@viu/emporix-sdk-next": patch
---

`emporixSiteProxy` schreibt `emporix.siteCode` und `emporix.language` nur noch bei
einer echten Top-Level-Navigation als `Set-Cookie`.

Vorher schrieb jeder Request, der die Middleware erreichte — auch ein
`<Link>`-Prefetch. Ein Link in die andere Sprache stellte damit die Sprache des
Besuchers um, sobald er ins Blickfeld geriet, und die Sitzungsrouten renderten
danach in einer Sprache, die niemand gewählt hatte. Mit einem echten Chrome-Prefetch
gegen einen Produktions-Build reproduziert.

Erkannt wird über `sec-fetch-mode`: `navigate` ist eine Navigation, alles
fetch-basierte nicht. Fehlt der Header — alte Clients, `curl`, Bots — gilt
Navigation, damit deren Verhalten unverändert bleibt. Die Injektion in die
weitergeleiteten Request-Cookies passiert weiterhin immer, sodass auch ein
spekulativer Render die Sprache seiner eigenen URL benutzt.

Auf «ist ein Prefetch» wird bewusst nicht geprüft: Next entfernt seine Router-Signale
(`next-router-prefetch`, `rsc`, `next-router-segment-prefetch`, den
`_rsc`-Query-Parameter), bevor die Middleware läuft — gemessen auf Next 16.2.12. Ein
Prefetch ist dort nicht von einer echten clientseitigen Navigation zu unterscheiden.

Die Token-Rotation in `emporixTokenProxy` ist absichtlich **nicht** so gegattert: wer
eine Stunde nur clientseitig navigiert, würde sonst nie rotieren.
