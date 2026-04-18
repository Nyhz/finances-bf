import { z } from "zod";

export const deactivateAssetSchema = z.object({
  id: z.string().min(1),
});

export type DeactivateAssetInput = z.input<typeof deactivateAssetSchema>;
