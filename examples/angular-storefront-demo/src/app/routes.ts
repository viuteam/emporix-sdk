import type { Routes } from "@angular/router";

/**
 * Lazy per route, so the initial bundle carries the shell and the catalog only.
 *
 * Ten routes. The two account extras exist to exercise the parts of the package
 * that unit tests can only mock: `/account/lists` drives a mutation bundle end to
 * end, and `/account/company` renders all three B2B modes including the
 * `unresolved` picker.
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
  { path: "account/lists", loadComponent: () => import("./pages/lists").then((m) => m.Lists) },
  {
    path: "account/company",
    loadComponent: () => import("./pages/company").then((m) => m.CompanyPage),
  },
  { path: "**", redirectTo: "" },
];
