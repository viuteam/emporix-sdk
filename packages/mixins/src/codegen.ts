export type { RawMixin, MixinSource } from "./codegen/types";
export { schemaService } from "./codegen/adapters/schema-service";
export { localFiles } from "./codegen/adapters/local-files";
export { cdnManifest } from "./codegen/adapters/cdn-manifest";
export { attributesToJsonSchema } from "./codegen/attributes-to-jsonschema";
export { buildLock, diffLock, type Lock, type LockEntry } from "./codegen/lock";
export { generateTypes } from "./codegen/generate";
