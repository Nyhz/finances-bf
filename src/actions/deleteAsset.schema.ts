import { z } from "zod";

export const deleteAssetSchema = z.object({
  id: z.string().min(1),
});

export type DeleteAssetInput = z.input<typeof deleteAssetSchema>;
