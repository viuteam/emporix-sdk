---
"@viu/emporix-sdk": patch
"@viu/emporix-sdk-react": patch
---

Order `exports` conditions so `types` resolves first. Node and the
TypeScript resolver evaluate `exports` conditions in declaration order;
with `import`/`require` listed before `types`, the `types` condition was
never reached, emitting build warnings and preventing consumers from
picking up the generated `.d.ts` entry points. Every subpath in both
packages now uses `{ types, import, require }` order.
