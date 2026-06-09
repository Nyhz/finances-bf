import { z } from "zod";
import { toIsoDate } from "../lib/time";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict calendar date: right shape AND round-trips through Date, so
 * impossible dates like 2025-13-45 or 2025-02-30 are rejected (a bare regex
 * lets them through and they become NaN timestamps downstream).
 */
export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_RE, "must be ISO yyyy-MM-dd")
  .refine((d) => toIsoDate(new Date(`${d}T12:00:00.000Z`)) === d, {
    message: "not a valid calendar date",
  });

/** Entry-form date: valid calendar date that is not in the future. */
export const isoDatePastSchema = isoDateSchema.refine(
  (d) => d <= toIsoDate(new Date()),
  { message: "date cannot be in the future" },
);
