import type { ReactNode } from "react";
import { iconSvg, isIconName, wrapIcon } from "@shared/icons";
import { appIconUrl, uploadUrl } from "@/api";
import { useCatalog } from "@/lib/icon-data";

type Weight = "Outline" | "Filled";
const CATALOG_NAME = /^[a-z][a-z0-9-]{2,}$/;
const box = (size: number) => ({ display: "inline-flex", width: size, height: size, flex: "none" }) as const;

/** A Tabler icon or brand mark from the shared set (24x24, currentColor). Unknown names render nothing. Outline by default, Filled for selected/active states. */
export function Icon({ name, size = 18, className, weight = "Outline" }: { name: string; size?: number; className?: string; weight?: Weight }) {
  const svg = iconSvg(name, { size, weight });
  if (!svg) return null;
  return <span aria-hidden="true" className={className} style={box(size)} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Inner markup from the full Tabler catalog (loaded lazily from the agent). O is stroked, F is filled; some icons only have F. */
export function CatalogGlyph({ name, size = 18, className, weight = "Outline" }: { name: string; size?: number; className?: string; weight?: Weight }) {
  const { catalog } = useCatalog(true);
  const ic = catalog?.icons[name];
  if (!ic) return null;
  const filled = !!ic.F && (weight === "Filled" || !ic.O);
  const svg = wrapIcon(filled ? ic.F! : (ic.O ?? ""), { variant: filled ? "F" : "O", size });
  return <span aria-hidden="true" className={className} style={box(size)} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** A LobeHub mark from the catalog's brands section (icon value `lobe:<name>`). */
export function LobeGlyph({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const { catalog, loading } = useCatalog(true);
  const b = catalog?.brands?.[name];
  if (!b) return <span aria-hidden="true" className={className} style={box(size)} title={loading ? undefined : name} />;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={b.vb} fill={b.color ? undefined : "currentColor"} className={className} style={{ flex: "none" }} dangerouslySetInnerHTML={{ __html: b.body }} />
  );
}

function CatalogOrText({ icon, size, className, weight }: { icon: string; size: number; className?: string; weight?: Weight }) {
  const { catalog, loading } = useCatalog(true);
  if (catalog?.icons[icon]) return <CatalogGlyph name={icon} size={size} className={className} weight={weight} />;
  if (loading) return <span aria-hidden="true" className={className} style={box(size)} />;
  return <span className={className} style={{ fontSize: size * 0.9, lineHeight: 1 }}>{icon}</span>;
}

function Picture({ src, size, className }: { src: string; size: number; className?: string }) {
  return <img src={src} width={size} height={size} alt="" loading="lazy" draggable={false} className={className} style={{ width: size, height: size, objectFit: "contain", flex: "none", borderRadius: size * 0.2 }} />;
}

/** An item's `icon`: Tabler/brand name, catalog name, `app:<bundleId>`, `img:<id>`, or short text/emoji. */
export function ItemIcon({ icon, size = 18, className, weight }: { icon: string | undefined; size?: number; className?: string; weight?: Weight }): ReactNode {
  if (!icon) return null;
  if (icon.startsWith("app:")) return <Picture src={appIconUrl(icon.slice(4))} size={size} className={className} />;
  if (icon.startsWith("lobe:")) return <LobeGlyph name={icon.slice(5)} size={size} className={className} />;
  if (icon.startsWith("img:")) return <Picture src={uploadUrl(icon.slice(4))} size={size} className={className} />;
  if (isIconName(icon)) return <Icon name={icon} size={size} className={className} weight={weight} />;
  if (CATALOG_NAME.test(icon)) return <CatalogOrText icon={icon} size={size} className={className} weight={weight} />;
  return <span className={className} style={{ fontSize: size * 0.9, lineHeight: 1 }}>{icon}</span>;
}
