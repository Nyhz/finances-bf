// 2-decimal EUR rounding. Matches the inline round helper that has been used
// across actions since inception. Uses Math.round (half toward +Infinity) —
// keep this behaviour for consistency with existing stored values.
export function roundEur(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
