import {sqliteTable,text,integer,index} from "drizzle-orm/sqlite-core";
export const entries=sqliteTable("entries",{id:text("id").primaryKey(),owner:text("owner").notNull(),kind:text("kind").notNull(),body:text("body").notNull(),createdAt:text("created_at").notNull()},t=>[index("entries_owner_kind").on(t.owner,t.kind)]);
export const aiUsage=sqliteTable("ai_usage",{id:text("id").primaryKey(),requests:integer("requests").notNull().default(0),lastAt:integer("last_at").notNull().default(0)});
export const analyses=sqliteTable("analyses",{id:text("id").primaryKey(),owner:text("owner").notNull(),body:text("body").notNull(),createdAt:text("created_at").notNull()});
