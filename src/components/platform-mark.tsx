import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/markets/types";

export function PlatformMark({ platform }: { platform: Platform }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium capitalize", platform === "kalshi" ? "text-foreground" : "text-muted")}>
      <span className={cn("size-1.5 rounded-full", platform === "kalshi" ? "bg-foreground" : "bg-muted")} />
      {platform}
    </span>
  );
}
