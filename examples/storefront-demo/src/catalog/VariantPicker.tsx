import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Product } from "@viu/emporix-sdk";
import { useVariantChildren } from "@viu/emporix-sdk-react";
import { catId, matchingVariants, productName, variantAxes, variantSelection } from "../lib/adapters";

/** Template variants (PARENT_VARIANT → VARIANT): one link per child. */
export function VariantPicker({ productId }: { productId: string }) {
  const { data } = useVariantChildren(productId);
  const variants = data ?? [];
  if (variants.length === 0) return null;
  return (
    <div className="variants">
      <span className="field__label">Variants</span>
      <div className="cluster variants__list">
        {variants.map((v) => (
          <Link key={catId(v)} to={`/product/${encodeURIComponent(catId(v))}`} className="tag">
            {productName(v)}
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Dynamic variants (root → colour → size): one radio group per attribute, built
 * from the tree's sellable variants. Shown on the root and on every variant, with
 * the current product's values selected.
 *
 * Each sellable variant keeps its own URL. A complete selection navigates there;
 * a partial one (on the root or a colour node) is held here until it is complete.
 * Render it with `key={current product id}` so a new page starts without that state.
 */
export function DynamicVariantPicker({ variants, current }: { variants: Product[]; current: Product }) {
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const axes = variantAxes(variants);
  if (axes.length === 0) return null;
  const selection = { ...variantSelection(current), ...picked };

  function choose(axis: string, value: string) {
    const next = { ...selection, [axis]: value };
    if (!axes.every((a) => next[a.key])) {
      setPicked((p) => ({ ...p, [axis]: value }));
      return;
    }
    // No exact match (a gap in the matrix): take a variant with the value just chosen.
    const target = matchingVariants(variants, next)[0] ?? matchingVariants(variants, { [axis]: value })[0];
    if (target) navigate(`/product/${encodeURIComponent(target)}`, { replace: true });
  }

  return (
    <div className="variants">
      {axes.map((axis) => {
        const others = Object.fromEntries(Object.entries(selection).filter(([key]) => key !== axis.key));
        return (
          <fieldset key={axis.key} className="variant-axis">
            <legend className="field__label">{axis.label}</legend>
            <div className="cluster variants__list">
              {axis.values.map((v) => (
                <label key={v.key} className="tag variant-option">
                  <input
                    type="radio"
                    name={`variant-${axis.key}`}
                    value={v.key}
                    checked={selection[axis.key] === v.key}
                    // Unavailable with the other values chosen so far.
                    disabled={matchingVariants(variants, { ...others, [axis.key]: v.key }).length === 0}
                    onChange={() => choose(axis.key, v.key)}
                  />
                  {v.label}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
