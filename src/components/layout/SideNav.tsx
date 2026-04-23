"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Coins,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  Upload,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/src/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const primaryItems: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/assets", label: "Assets", icon: Coins },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/imports", label: "Imports", icon: Upload },
  { href: "/taxes", label: "Taxes", icon: Receipt },
];

const secondaryItems: NavItem[] = [
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav() {
  const pathname = usePathname();

  const renderItem = ({ href, label, icon: Icon }: NavItem) => {
    const active = isActive(pathname, href);
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            active
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span>{label}</span>
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="hidden h-full w-56 shrink-0 flex-col border-r border-border bg-background md:flex"
    >
      <ul className="flex flex-col gap-0.5 p-3">
        {primaryItems.map(renderItem)}
      </ul>
      <ul className="mt-auto flex flex-col gap-0.5 border-t border-border/60 p-3">
        {secondaryItems.map(renderItem)}
      </ul>
    </nav>
  );
}
