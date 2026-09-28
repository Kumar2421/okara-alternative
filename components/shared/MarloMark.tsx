export function MarloMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill="#111111" />
      <circle cx="18.5" cy="9.5" r="7" fill="#ffffff" fillOpacity="0.95" />
      <circle cx="18.5" cy="9.5" r="3.2" fill="#111111" />
    </svg>
  );
}
