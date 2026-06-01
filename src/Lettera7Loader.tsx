import { useState } from "react";

interface Lettera7LoaderProps {
  label?: string;
  size?: number;
  background?: string;
}

export default function Lettera7Loader({
  label = "Caricamento…",
  size = 220,
  background = "#ffffff",
}: Lettera7LoaderProps) {
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background,
        zIndex: 9999,
      }}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {videoFailed ? (
        <img
          src="/lettera7-loader.gif"
          alt="Lettera7"
          width={size}
          height={size}
          style={{ display: "block" }}
        />
      ) : (
        <video
          src="/lettera7-loader.webm"
          width={size}
          height={size}
          autoPlay
          loop
          muted
          playsInline
          onError={() => setVideoFailed(true)}
          style={{ display: "block" }}
        />
      )}

      {label && (
        <span
          style={{
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: "#6b6b6b",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
