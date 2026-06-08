import { schemaService } from "@viu/emporix-mixins/codegen";
import { EmporixClient, auth } from "@viu/emporix-sdk";

/**
 * Codegen config for the demo. Tenant + storefront client id come from the
 * environment so no credentials are committed — viu allows anonymous schema
 * reads, so the public storefront client id is enough:
 *
 *   EMPORIX_TENANT=viu EMPORIX_STOREFRONT_CLIENT_ID=<public-id> \
 *     pnpm -F @viu/emporix-examples-storefront-demo exec emporix-mixins pull
 *   ...exec emporix-mixins generate
 */
const client = new EmporixClient({
  tenant: process.env.EMPORIX_TENANT ?? "",
  credentials: { storefront: { clientId: process.env.EMPORIX_STOREFRONT_CLIENT_ID ?? "" } },
  logger: false,
});

export default {
  source: schemaService({ client, auth: auth.anonymous() }),
  out: "src/mixins/generated",
  lockfile: "src/mixins/mixins.lock.json",
};
