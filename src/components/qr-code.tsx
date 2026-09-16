"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCode({
  value,
  size = 200,
}: {
  value: string;
  size?: number;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: "#0a0a12", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  return (
    <div
      className="rounded-2xl bg-white p-3 shadow-lg"
      style={{ width: size + 24, height: size + 24 }}
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt="Scan to open the phone answer view"
          width={size}
          height={size}
          className="h-full w-full"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
          Generating…
        </div>
      )}
    </div>
  );
}
