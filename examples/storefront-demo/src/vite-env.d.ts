/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_DEFAULT_TENANT?: string;
  readonly VITE_DEMO_DEFAULT_STOREFRONT_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
