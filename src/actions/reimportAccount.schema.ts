import { z } from "zod";

export const reimportAccountSchema = z.object({
  accountId: z.string().min(1),
});

export type ReimportAccountInput = z.input<typeof reimportAccountSchema>;
