"use client";
import { Button } from "@/src/components/ui/Button";
type Props = { year: number };
export function UnsealYearButton({ year: _year }: Props) {
  return <Button variant="danger" disabled>Unseal year</Button>;
}
