import { z } from "zod";
import { findKalshiComboQuotes } from "@/lib/kalshi/combo-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  combinations: z
    .array(
      z.object({
        key: z.string().min(1).max(500),
        legs: z
          .array(
            z.object({
              marketTicker: z.string().min(1).max(200),
              side: z.enum(["yes", "no"]),
            }),
          )
          .min(2)
          .max(10),
      }),
    )
    .max(24),
});

export async function POST(request: Request) {
  try {
    const raw: unknown = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ quotes: [] }, { status: 400 });
    }

    const quotes = await findKalshiComboQuotes(parsed.data.combinations);
    return Response.json(
      { quotes, fetchedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("Builder combo quote route failed", error);
    return Response.json({ quotes: [] }, { status: 200 });
  }
}
