"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/src/components/ui/Button";

type SensitiveState = "hidden" | "visible";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-sensitive"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): SensitiveState {
  return document.documentElement.getAttribute("data-sensitive") === "hidden"
    ? "hidden"
    : "visible";
}

function getServerSnapshot(): SensitiveState {
  return "visible";
}

export function SensitiveToggle() {
  const state = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  function toggle() {
    const next: SensitiveState = state === "hidden" ? "visible" : "hidden";
    document.documentElement.setAttribute("data-sensitive", next);
    try {
      window.localStorage.setItem("sensitive", next);
    } catch {
      // ignore storage failures
    }
  }

  const hidden = state === "hidden";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={hidden ? "Reveal values" : "Hide values"}
    >
      {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  );
}
