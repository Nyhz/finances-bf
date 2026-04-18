import { z } from "zod";

export const deleteCashMovementSchema = z.object({
  id: z.string().min(1),
});

export type DeleteCashMovementInput = z.input<typeof deleteCashMovementSchema>;
