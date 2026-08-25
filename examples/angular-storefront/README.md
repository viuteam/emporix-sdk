# angular-storefront

Smallest Angular integration of `@viu/emporix-sdk-angular`, on Angular 22.

**Its job is not to be a storefront.** It exists to prove that the tsup-built
`@viu/emporix-sdk-angular` artifact survives a real AOT production build — the
premise the whole package rests on, because that package is deliberately built
without `ng-packagr`.

```bash
pnpm -F @viu/emporix-sdk-angular build
pnpm -F @viu/emporix-examples-angular exec ng build --configuration production
```

That build runs in `pr-check.yml` on every PR.

## Why it renders a value instead of nothing

`src/app/app.ts` injects the SDK client back out of Angular's DI and the template
prints the tenant. A production build could succeed while `provideEmporix`'s
`InjectionToken`s failed to resolve at runtime — for instance if the optimizer
dropped something it judged unused. Printing a value that only exists if
injection worked turns the build into a real probe rather than a compile check.

`src/app/app.config.ts` imports from both the package root and the `/storage`
subpath, so the `exports` map is exercised the way a consumer's bundler sees it,
not only the way `tsc` does.

## Two version notes

- **Node.** The Angular CLI enforces `^22.22.3 || ^24.15.0 || >=26.0.0` itself and
  exits before building on anything older — a warning is not enough here, unlike
  `pnpm install`. The CI matrix skips this build on its Node 20 row for that
  reason.
- **TypeScript.** `@angular/compiler-cli@22` peers `typescript >=6.0 <6.1`, so
  this example declares TypeScript 6 while the rest of the workspace is on 5.9.
  It is contained here; `packages/angular` itself compiles fine on 5.9.

Decorators are used in this app and that is not a contradiction: the
no-decorator rule applies to `packages/angular`, which is compiled by tsup. This
app is compiled by the Angular CLI.
