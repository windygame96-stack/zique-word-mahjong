import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("rooms_code_unique").on(table.code)]);

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  wechatOpenid: text("wechat_openid").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("accounts_wechat_openid_unique").on(table.wechatOpenid)]);

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  accountId: text("account_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  returnTo: text("return_to").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
