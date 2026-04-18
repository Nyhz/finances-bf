import { z } from "zod";

export const deleteAccountSchema = z.object({
  id: z.string().min(1),
});

export type DeleteAccountInput = z.input<typeof deleteAccountSchema>;
