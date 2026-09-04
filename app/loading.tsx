function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-gray-200 ${className}`} />;
}

function ColumnSkeleton({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`flex h-full flex-col border-r ${dark ? "border-white/10 bg-[#110f0e]" : "border-gray-200 bg-white"} p-4`}>
      <div className={`mb-4 h-4 w-24 animate-pulse rounded ${dark ? "bg-white/10" : "bg-gray-200"}`} />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`h-14 animate-pulse rounded-xl ${dark ? "bg-white/5" : "bg-gray-100"}`} />
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="flex h-screen flex-col bg-white">
      <div className="flex h-[52px] shrink-0 items-center justify-between bg-[#110f0e] px-4">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-pulse rounded-full bg-white/10" />
          <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 animate-pulse rounded-full bg-white/10" />
          <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[22%_26%_26%_26%]">
        <ColumnSkeleton />
        <ColumnSkeleton />
        <ColumnSkeleton />
        <ColumnSkeleton dark />
      </div>
    </div>
  );
}
