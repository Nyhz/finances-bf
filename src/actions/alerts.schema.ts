import { z } from "zod";
import { ALERT_KINDS } from "../db/schema";

export const createAlertSchema = z.object({
  assetId: z.string().min(1),
  kind: z.enum(ALERT_KINDS),
  threshold: z.number().positive("El umbral debe ser mayor que 0"),
  notifyTelegram: z.boolean().default(false),
});

export const updateAlertSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(ALERT_KINDS),
  threshold: z.number().positive("El umbral debe ser mayor que 0"),
  notifyTelegram: z.boolean().default(false),
});

export const deleteAlertSchema = z.object({
  id: z.string().min(1),
});

export const acknowledgeAlertEventSchema = z.object({
  id: z.string().min(1),
});

export type CreateAlertInput = z.input<typeof createAlertSchema>;
export type UpdateAlertInput = z.input<typeof updateAlertSchema>;
