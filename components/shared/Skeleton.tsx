/** Loading placeholders shared by every panel, so loading looks the same everywhere. */

export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`h-3 animate-pulse rounded bg-gray-200 ${className}`} />;
}

/** A few text-like rows. */
export function SkeletonLines({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonLine key={i} className={i === rows - 1 ? "w-2/3" : "w-full"} />
      ))}
    </div>
  );
}

/** A row of stat tiles. */
export function SkeletonStats({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-[66px] animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}

/** A titled card with text rows, matching the dashboard cards. */
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4" role="status" aria-label="Loading">
      <SkeletonLine className="mb-4 w-1/3" />
      <SkeletonLines rows={rows} />
    </div>
  );
}
