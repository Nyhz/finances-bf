"use client";
import { Button } from "@/src/components/ui/Button";
type Props = { year: number };
export function SealYearButton({ year: _year }: Props) {
  return <Button disabled>Seal year</Button>;
}
