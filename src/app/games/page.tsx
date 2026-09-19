import type { Metadata } from "next";
import { Suspense } from "react";
import { GameBoard } from "@/components/game-board";

export const metadata: Metadata = { title: "NFL Games" };

export default function GamesPage() {
  return (
    <Suspense
      fallback={
        <div className="premium-panel rounded-2xl px-6 py-20 text-center text-sm text-muted">
          Loading NFL games...
        </div>
      }
    >
      <GameBoard />
    </Suspense>
  );
}
