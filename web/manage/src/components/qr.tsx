import { useMemo } from "react";
import { t } from "@/lib/i18n";
import qrcode from "qrcode-generator";

/** QR code as inline SVG (qrcode-generator, MIT, bundled). Black on white with a quiet zone, readable by phone cameras in both themes. */
export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    }
    return { d, n: n + 8 };
  }, [value]);
  return (
    <svg role="img" aria-label={t("QR code for pairing")} width={size} height={size} viewBox={`0 0 ${path.n} ${path.n}`} shapeRendering="crispEdges" className="rounded-lg">
      <rect width={path.n} height={path.n} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}
