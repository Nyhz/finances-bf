import * as React from "react";
import { SideNav } from "@/src/components/layout/SideNav";
import { TopNav } from "@/src/components/layout/TopNav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
