import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { diffList, orgAndSender } from "./common.ts";

const ACTIONS = { created: "created", edited: "updated", deleted: "deleted" } as const;

export const customProperty: Adapter = {
  name: "custom_property",
  scope: "org",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    if (!ctx.org) return;
    const result = await ctx.gh.get<any[]>(`/orgs/${ctx.org}/properties/schema`, {
      etagKey: `custom-properties:${ctx.org}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await orgAndSender(ctx);
    const entries = result.data.map((definition) => ({
      key: definition.property_name,
      state: sha256(JSON.stringify(definition)),
      item: definition,
    }));
    diffList(ctx, "custom_property", entries, true, (change, definition, stamp) => {
      const action = ACTIONS[change];
      ctx.emit(
        "custom_property",
        action,
        definition.property_name,
        { action, definition, ...meta },
        `${stamp}:${action}`,
      );
    });
  },
};
