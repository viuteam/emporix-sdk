import { useState } from "react";
import type { Media } from "@viu/emporix-sdk";
import { imageOf } from "../lib/adapters";

export function ProductGallery({ media, alt }: { media: Media[]; alt: string }) {
  const urls = media.map((m) => m.url ?? m.cloudinaryUrl).filter((u): u is string => Boolean(u));
  const [active, setActive] = useState(0);
  const hero = urls[active] ?? imageOf(media);

  return (
    <div>
      <div className="pdp__hero">
        {hero ? <img src={hero} alt={alt} /> : <div className="pc__ph" style={{ aspectRatio: "1 / 1" }} />}
      </div>
      {urls.length > 1 ? (
        <div className="pdp__thumbs">
          {urls.map((u, i) => (
            <button
              key={u}
              type="button"
              className={`pdp__thumb${i === active ? " is-active" : ""}`}
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}`}
            >
              <img src={u} alt="" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
