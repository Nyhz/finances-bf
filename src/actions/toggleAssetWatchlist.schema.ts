import { z } from "zod";

export const toggleAssetWatchlistSchema = z.object({
  id: z.string().min(1),
  watchlisted: z.boolean(),
});

export type ToggleAssetWatchlistInput = z.input<typeof toggleAssetWatchlistSchema>;
