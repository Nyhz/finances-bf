import * as React from "react";
import { SideNav } from "@/src/components/layout/SideNav";
import { TopNav } from "@/src/components/layout/TopNav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        {/* scrollbar-gutter reserva el carril aunque no haya scrollbar: al
            navegar entre páginas cortas y largas (o al resolver skeletons)
            el contenido no se desplaza lateralmente. */}
        <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">{children}</main>
      </div>
    </div>
  );
}
