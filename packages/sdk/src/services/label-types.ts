/**
 * Public types for the Label Service — stable names aliased over the generated
 * `label-service` types. The list endpoint returns a plain `Label[]` (no named
 * list schema upstream).
 */
import type {
  Label as GenLabel,
  LabelCreation,
  LabelUpdate as GenLabelUpdate,
} from "../generated/label-service";

/** A label (read shape). */
export type Label = GenLabel;
/** List of labels (`GET /label/labels`) — a plain array. */
export type LabelList = Label[];
/** Create body (`POST /label/labels`). */
export type LabelInput = LabelCreation;
/** Update / patch body (`PUT` / `PATCH /label/labels/{id}`). */
export type LabelUpdate = GenLabelUpdate;
