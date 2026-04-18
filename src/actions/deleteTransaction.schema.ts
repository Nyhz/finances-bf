import { z } from "zod";

export const deleteTransactionSchema = z.object({
  id: z.string().min(1),
});

export type DeleteTransactionInput = z.input<typeof deleteTransactionSchema>;
