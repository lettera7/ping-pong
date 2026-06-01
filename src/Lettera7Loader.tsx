import { CSSProperties, useState } from "react";

interface Lettera7LoaderProps {
  label?: string;
  size?: number;
  background?: string;
}

export default function Lettera7Loader({
  label = "Caricamento…",
  size = 220,
  background = "#fff",
}: Lettera7LoaderProps) {
  const [useGif, setUseGif] = useState(false);

  const wrap: CSSProperties = {
    position: "fixed",
    inset: 0,
    background,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    zIndex: 9999,
  };

  return (
    <div style={wrap} role="status" aria-live="polite" aria-label={label}>
      {useGif ? (
        <img
          src="/lettera7-loader.gif"
          alt=""
          aria-hidden="true"
          style={{ width: size, height: size, objectFit: "contain" }}
        />
      ) : (
        <video
          src="/lettera7-loader.webm"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          style={{ width: size, height: size, objectFit: "contain" }}
          onError={() => setUseGif(true)}
        />
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}
