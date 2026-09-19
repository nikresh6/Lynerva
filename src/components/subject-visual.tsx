"use client";

import { useState } from "react";
import type { MarketOpportunity } from "@/lib/markets/types";
import { cn } from "@/lib/utils";
import type { PlayerVisualData } from "./player-visuals";

const TEAM_CODES = new Set([
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB",
  "HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS",
]);

export function teamLogo(team: string) {
  const slug = team === "WAS" ? "wsh" : team.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`;
}

export function SubjectVisual({
  market,
  visual,
  size = "md",
  className,
}: {
  market: MarketOpportunity;
  visual?: PlayerVisualData | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const subject = market.canonical?.subject ?? "";
  const matchup = market.canonical?.matchup?.split("-") ?? [];
  const dimension =
    size === "sm" ? "size-9" : size === "lg" ? "size-16" : "size-12";
  const badgeSize = size === "sm" ? "size-4" : "size-5";

  if (TEAM_CODES.has(subject)) {
    return (
      <div
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden rounded-[14px] border bg-background p-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]",
          dimension,
          className,
        )}
      >
        <img
          loading="lazy"
          src={teamLogo(subject)}
          alt={subject}
          className="size-full object-contain"
        />
      </div>
    );
  }

  const initials =
    subject
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "NFL";

  const showImage = Boolean(visual?.imageUrl) && !imageFailed;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-visible rounded-[14px]",
        dimension,
        className,
      )}
    >
      <div className="absolute inset-0 overflow-hidden rounded-[14px] border bg-[linear-gradient(145deg,var(--surface-raised),var(--background))] shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
        {showImage ? (
          <img
            loading="lazy"
            src={visual?.imageUrl ?? ""}
            alt={subject}
            onError={() => setImageFailed(true)}
            className="size-full object-cover object-top"
          />
        ) : (
          <div className="grid size-full place-items-center text-xs font-bold tracking-[-0.02em] text-muted">
            {initials}
          </div>
        )}
        {showImage ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/28 to-transparent" />
        ) : null}
      </div>

      <div className="absolute -bottom-1 -right-1 flex">
        {matchup.slice(0, 2).map((team, index) => (
          <span
            key={team}
            className={cn(
              "grid place-items-center rounded-full border bg-surface p-0.5 shadow-sm",
              badgeSize,
              index ? "-ml-1.5" : "",
            )}
          >
            <img
              loading="lazy"
              src={teamLogo(team)}
              alt=""
              className="size-full object-contain"
            />
          </span>
        ))}
      </div>
    </div>
  );
}
