import { redirect } from "next/navigation";
import { getTaxYears } from "@/src/server/taxes";

export const dynamic = "force-dynamic";

export default async function TaxesIndex() {
  const years = await getTaxYears();
  const now = new Date().getUTCFullYear();
  const target = years[0] ?? now;
  redirect(`/taxes/${target}`);
}
