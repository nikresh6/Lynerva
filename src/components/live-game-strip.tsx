import type { LiveNflGame } from "@/lib/nfl/live";

export function LiveGameStrip({ games }: { games: LiveNflGame[] }) {
  const live = games.filter((game) => game.state === "in");
  if (!live.length) return null;
  return <div className="scrollbar-subtle mb-4 flex gap-2 overflow-x-auto pb-1">{live.map((game) => <div key={game.id} className="min-w-[210px] rounded-md border bg-surface px-3 py-2.5"><div className="mb-2 flex items-center justify-between text-[10px] text-muted"><span>{game.status}</span><span>{game.clock}</span></div><div className="flex items-center justify-between font-medium tabular"><span>{game.away.team}</span><span>{game.away.score}</span></div><div className="mt-1 flex items-center justify-between font-medium tabular"><span>{game.home.team}</span><span>{game.home.score}</span></div>{game.possession ? <p className="mt-2 text-[10px] text-faint">Possession: {game.possession}</p> : null}</div>)}</div>;
}
