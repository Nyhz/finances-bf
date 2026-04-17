import { Card } from "@/src/components/ui/Card";

function maskPath(p: string | undefined): string {
  if (!p) return "(unset)";
  if (p.length <= 8) return "••••";
  return `${p.slice(0, 4)}…${p.slice(-6)}`;
}

export default function SettingsPage() {
  const rows: { label: string; value: string }[] = [
    { label: "App name", value: "Finances Panel" },
    { label: "Base currency", value: "EUR" },
    { label: "DB_PATH", value: maskPath(process.env.DB_PATH) },
    { label: "Node runtime", value: process.version },
  ];

  return (
    <div className="flex flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Runtime configuration (read-only).
        </p>
      </header>

      <Card title="Runtime">
        <dl className="divide-y divide-border">
          {rows.map((r) => (
            <div
              key={r.label}
              className="grid grid-cols-[10rem_1fr] gap-4 py-3 text-sm"
            >
              <dt className="font-medium text-muted-foreground">{r.label}</dt>
              <dd className="font-mono tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
