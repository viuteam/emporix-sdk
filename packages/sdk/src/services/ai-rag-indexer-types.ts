import type { MetadataFilter as GenMetadataFilter } from "../generated/ai-rag-indexer";

/**
 * A filterable metadata field exposed by the RAG index. `key` is the field
 * name and `type` its scalar/structured kind. `name` and `description` are
 * **deprecated** upstream — present for wire compatibility, do not rely on them.
 */
export type MetadataFilter = GenMetadataFilter;

/**
 * Indexable resource type. Only `"PRODUCT"` exists today; modelled as a string
 * union so future types can extend it without a breaking change. Every
 * {@link RagIndexerService} method defaults its `type` argument to `"PRODUCT"`.
 */
export type RagType = "PRODUCT";
