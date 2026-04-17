import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: idCol(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(), // create | update | delete
    actorType: text("actor_type").notNull().default("user"), // user | system
    source: text("source").notNull().default("ui"),
    summary: text("summary"),
    previousJson: text("previous_json"),
    nextJson: text("next_json"),
    contextJson: text("context_json"),
    createdAt: createdAtCol(),
  },
  (t) => ({
    entityIdx: index("audit_events_entity_idx").on(t.entityType, t.entityId),
    createdAtIdx: index("audit_events_created_at_idx").on(t.createdAt),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
