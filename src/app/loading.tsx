export default function Loading() {
  return (
    <div className="animate-pulse" aria-label="Loading markets">
      <div className="mb-8 h-9 w-64 rounded bg-border" />
      <div className="mb-4 h-14 rounded-lg border bg-surface" />
      <div className="overflow-hidden rounded-lg border bg-surface">
        <div className="h-10 bg-surface-raised" />
        {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-14 border-t" />)}
      </div>
    </div>
  );
}
