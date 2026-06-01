const FLASH_PATH =
  'M77.7,107.46c-14.85-3.96-24.32,12.47-28.19,25.01-.57,1.84-2.27,2.83-4.12,2.4s-2.82-2.21-2.42-4.16c2.36-11.46,2.05-24.68-9.81-29.77-8.58-3.69-19.87-2.63-28.94-.36-1.8.45-3.48-.51-4.03-2.18s.21-3.41,1.9-4.23c3.78-1.85,7.15-4.16,10.15-7.07,9.52-9.22,8.67-21.53,3.34-32.85l-.19-.57c-3.46-7.27-7.97-13.73-13.26-19.66-1.23-1.32-1.14-3.2-.09-4.45,1.13-1.33,2.87-1.5,4.45-.65,13.97,7.52,30.94,12.02,43.9.7,7.78-6.79,12.46-17.22,14.77-27.2.41-1.79,2.21-2.67,3.85-2.37,1.78.32,2.84,1.86,2.71,3.77-1.19,17.99.28,43.44,17.8,52.85,0,0,7.22,4.76,20.75,3.45,3.64-.36,7.04-1.04,10.6-1.96l7.99-2.17c1.16.31,1.94,1.02,2.31,1.79.55,1.14.32,2.27-.23,3.39l-14.18,7.07-7,4.14-4.47,3.33c-8.54,6.82-14.48,16.15-11.41,27.05,1.07,3.79,2.8,7.24,5.34,10.25,1.21,1.43,1.34,3.43-.01,4.8-1.19,1.21-3.27,1.39-4.67.1-4.89-4.51-10.39-8.73-16.86-10.46ZM50.5,114.4c2.58-3.63,5.06-6.69,8.39-9.19,5.49-4.34,12.32-5.99,19.19-4.57,3.24.65,6.12,1.85,9.17,3.42-1.99-7.98-.55-15.99,3.81-22.76,3.94-5.68,9.84-10.66,15.6-14.86-4.23.76-10.64.04-17.1-2.29-3.91-1.63-7.38-3.83-10.5-6.75l-3.39-3.73c-3.23-4.11-5.45-8.57-7.11-13.51-1.98-5.91-2.95-11.82-3.52-18.24-7.12,12.62-17.84,21.1-32.77,21.26-5.72.11-11.05-1.08-16.61-2.81,2.82,4.39,5.19,8.6,7.08,13.3l1.38,3.75c4.02,12.75,2.64,24.67-7.01,34.4,5.8-.04,10.93.27,16.07,1.94,4.78,1.55,8.92,4.15,12.05,8.05,2.94,3.63,4.41,7.84,5.27,12.58Z';

const LETTERS = [
  'M3.79,23.18h15.03v3.86H0v-4.13C5.18,17.73,9.2,10.04,9.66,0h4.75c-.54,8.96-4.37,18.16-10.62,23.18Z',
  'M22.87,0h18.2v3.59h-13.91v7.73h13.29v3.67h-13.29v8.42h14.41v3.63h-18.7V0Z',
  'M52.9,3.59h-9.2V0h22.64v3.59h-9.16v23.45h-4.29V3.59Z',
  'M76.97,3.59h-9.2V0h22.64v3.59h-9.16v23.45h-4.29V3.59Z',
  'M94.01,0h18.2v3.59h-13.91v7.73h13.29v3.67h-13.29v8.42h14.41v3.63h-18.7V0Z',
  'M117.77,0h11.71c5.14,0,8.62,2.47,8.62,7.11,0,3.55-2.59,5.83-5.1,6.57,2.82.5,4.6,2.71,4.6,6.22v7.15h-4.33v-6.41c0-3.75-1.39-4.98-5.06-4.98h-6.14v11.4h-4.29V0ZM133.69,7.77c0-2.74-1.82-4.17-5.1-4.17h-6.53v8.38h6.53c3.28,0,5.1-1.47,5.1-4.21Z',
  'M151.12,0h5.02l11.01,27.04h-4.79l-2.9-7.73h-11.82l-2.94,7.73h-4.56L151.12,0ZM158.11,15.72l-3.63-9.62c-.35-.93-.62-1.7-.93-2.59-.27.89-.62,1.7-.93,2.59l-3.63,9.62h9.12Z',
  'M181.68,3.86h-15.03V0h18.85v4.1c-5.18,5.18-9.23,12.9-9.66,22.95h-4.75c.54-9,4.33-18.2,10.59-23.18Z',
];

const DUR = '2.8s';

const CSS = `
@keyframes l7-flash {
  0%   { transform: scale(0) rotate(-15deg); }
  6%   { transform: scale(1.05) rotate(0deg); }
  9%   { transform: scale(0.97) rotate(0deg); }
  12%  { transform: scale(1) rotate(0deg); }
  68%  { transform: scale(1) rotate(0deg); }
  74%  { transform: scale(1.12) rotate(8deg); }
  86%  { transform: scale(0) rotate(28deg); }
  100% { transform: scale(0) rotate(-15deg); }
}
@keyframes l7-flash-clip {
  0%   { clip-path: circle(0% at 50% 50%); }
  9%   { clip-path: circle(75% at 50% 50%); }
  100% { clip-path: circle(75% at 50% 50%); }
}
.l7-root { position: relative; display: grid; place-items: center; }
.l7-flash {
  position: absolute;
  transform-origin: 50% 50%;
  animation: l7-flash ${DUR} cubic-bezier(.16,1,.3,1) infinite,
             l7-flash-clip ${DUR} cubic-bezier(.16,1,.3,1) infinite;
  z-index: 2;
}
.l7-text { position: absolute; z-index: 1; overflow: visible; }
`;

function buildLetterKeyframes(n: number): string {
  let css = '';
  for (let i = 0; i < n; i++) {
    const inStart = 4 + i * 1.8;
    const inEnd = inStart + 6;
    const outStart = 84 + i * 1.5;
    const outEnd = outStart + 5;
    css += `
@keyframes l7-letter-${i} {
  0% { transform: scaleY(0); }
  ${inStart.toFixed(2)}% { transform: scaleY(0); }
  ${inEnd.toFixed(2)}% { transform: scaleY(1); }
  ${outStart.toFixed(2)}% { transform: scaleY(1); }
  ${outEnd.toFixed(2)}% { transform: scaleY(0); }
  100% { transform: scaleY(0); }
}
.l7-letter-${i} {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: l7-letter-${i} ${DUR} cubic-bezier(.16,1,.3,1) infinite;
}`;
  }
  return css;
}

interface Lettera7LoaderProps {
  label?: string;
  size?: number;
  background?: string;
  color?: string;
}

export default function Lettera7Loader({
  label = 'Caricamento…',
  size = 360,
  background = '#ffffff',
  color = '#1d1d1b',
}: Lettera7LoaderProps) {
  const textW = size;
  const textScale = textW / 185.51;
  const textH = 27.04 * textScale;
  const flashScale = textScale * 0.806;
  const flashW = 131.5 * flashScale;
  const flashH = 134.97 * flashScale;

  const letterCss = buildLetterKeyframes(LETTERS.length);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 14, background, zIndex: 9999,
      }}
      role="status" aria-live="polite" aria-label={label}
    >
      <style>{CSS + letterCss}</style>

      <div className="l7-root" style={{ width: textW, height: flashH }}>
        <svg
          className="l7-text"
          width={textW} height={textH}
          viewBox="0 0 185.51 27.04"
          style={{ overflow: 'visible' }}
        >
          {LETTERS.map((d, i) => (
            <path key={i} className={`l7-letter-${i}`} d={d} fill={color} />
          ))}
        </svg>

        <svg
          className="l7-flash"
          width={flashW} height={flashH}
          viewBox="0 0 131.5 134.97"
        >
          <path d={FLASH_PATH} fill={color} />
        </svg>
      </div>

      {label && (
        <span style={{
          fontFamily: 'system-ui, sans-serif', fontSize: 13,
          letterSpacing: '0.25em', textTransform: 'uppercase', color: '#6b6b6b',
        }}>
          {label}
        </span>
      )}
    </div>
  );
}
