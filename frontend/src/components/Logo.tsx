// SwitchPilot brand mark: a dark hexagonal shield with a green "S" swoosh.
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="sp-g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      {/* hexagon shield */}
      <path
        d="M24 2 L42 12.5 V35.5 L24 46 L6 35.5 V12.5 Z"
        fill="#0b1220" stroke="url(#sp-g)" strokeWidth="2.5" strokeLinejoin="round"
      />
      {/* S swoosh */}
      <path
        d="M31 17 C31 12.5 18.5 12 18.5 18.5 C18.5 24 31 24 31 30 C31 36.5 18 36 17 31.5"
        fill="none" stroke="url(#sp-g)" strokeWidth="4.5" strokeLinecap="round"
      />
    </svg>
  );
}
