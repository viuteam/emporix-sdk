import type { Routes } from "@angular/router";

/**
 * Lazy per route, so the initial bundle carries the shell and the catalog only.
 *
 * The React demo has 17 routes; this one has 8 real ones. The difference is the
 * account extras — shopping lists, rewards and returns — whose injectables are in
 * the 74 that `@viu/emporix-sdk-angular` does not ship yet. See the README.
 */
export const routes: Routes = [
  { path: "", loadComponent: () => import("./pages/home").then((m) => m.Home) },
  { path: "search", loadComponent: () => import("./pages/search").then((m) => m.Search) },
  {
    path: "product/:id",
    loadComponent: () => import("./pages/product").then((m) => m.ProductPage),
  },
  { path: "cart", loadComponent: () => import("./pages/cart").then((m) => m.CartPage) },
  { path: "checkout", loadComponent: () => import("./pages/checkout").then((m) => m.Checkout) },
  { path: "login", loadComponent: () => import("./pages/login").then((m) => m.Login) },
  { path: "account", loadComponent: () => import("./pages/account").then((m) => m.Account) },
  {
    path: "account/credentials",
    loadComponent: () => import("./pages/credentials").then((m) => m.Credentials),
  },
  { path: "**", redirectTo: "" },
];
