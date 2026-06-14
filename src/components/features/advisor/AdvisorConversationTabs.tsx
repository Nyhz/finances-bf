"use client";

import * as React from "react";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";

export type ConversationTab = { id: string; title: string | null };

const tabTitle = (t: string | null) => (t && t.trim() ? t : "Nueva conversación");

export function AdvisorConversationTabs({
  conversations,
  activeId,
  busy,
  onSelect,
  onNew,
  onRename,
  onEnd,
}: {
  conversations: ConversationTab[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onEnd: (id: string) => void;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const [endTarget, setEndTarget] = React.useState<ConversationTab | null>(null);

  function startEdit(tab: ConversationTab) {
    setEditingId(tab.id);
    setEditValue(tabTitle(tab.title));
  }

  function commitEdit() {
    if (editingId) {
      const title = editValue.trim();
      if (title) onRename(editingId, title);
    }
    setEditingId(null);
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-2">
      {conversations.map((c) => {
        const active = c.id === activeId;
        return (
          <div
            key={c.id}
            className={`group flex shrink-0 items-center gap-1 rounded-t-md border-b-2 px-3 py-1.5 text-sm transition-colors ${
              active
                ? "border-primary bg-card font-medium"
                : "border-transparent text-muted-foreground hover:bg-card/60"
            }`}
          >
            {editingId === c.id ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit();
                  } else if (e.key === "Escape") {
                    setEditingId(null);
                  }
                }}
                maxLength={80}
                className="w-40 rounded border border-border bg-background px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                onDoubleClick={() => startEdit(c)}
                title={`${tabTitle(c.title)} — doble clic para renombrar`}
                className="max-w-[12rem] truncate text-left"
              >
                {tabTitle(c.title)}
              </button>
            )}
            <button
              type="button"
              aria-label="Terminar conversación"
              title="Terminar conversación"
              onClick={() => setEndTarget(c)}
              className="rounded px-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onNew}
        disabled={busy}
        title="Nueva conversación"
        className="shrink-0 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-50"
      >
        + Nueva
      </button>

      <ConfirmModal
        open={endTarget != null}
        onOpenChange={(o) => !o && setEndTarget(null)}
        title="Terminar conversación"
        description={
          <>
            Se eliminará «{endTarget ? tabTitle(endTarget.title) : ""}» y sus mensajes de forma
            permanente. La memoria del asesor no se ve afectada.
          </>
        }
        confirmLabel="Terminar"
        confirmVariant="danger"
        onConfirm={() => {
          if (endTarget) onEnd(endTarget.id);
          setEndTarget(null);
        }}
      />
    </div>
  );
}
