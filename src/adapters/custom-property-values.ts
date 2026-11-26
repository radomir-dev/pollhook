import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { diffList, orgAndSender, PAGE_SIZE } from "./common.ts";

const propertiesOf = (entry: any): unknown[] => entry?.properties ?? [];

export const customPropertyValues: Adapter = {
  name: "custom_property_values",
  scope: "org",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    if (!ctx.org) return;
    const result = await ctx.gh.get<any[]>(
      `/orgs/${ctx.org}/properties/values?per_page=${PAGE_SIZE}`,
      { etagKey: `custom-property-values:${ctx.org}` },
    );
    if (result.notModified || !result.data) return;
    const meta = await orgAndSender(ctx);
    const entries = result.data.map((entry) => ({
      key: entry.repository_name,
      state: sha256(JSON.stringify(propertiesOf(entry))),
      item: entry,
    }));
    diffList(ctx, "custom_property_values", entries, false, (change, entry, stamp, previous) => {
      if (change === "created" && propertiesOf(entry).length === 0) return;
      ctx.emit(
        "custom_property_values",
        "updated",
        entry.repository_name,
        {
          action: "updated",
          repository: {
            id: entry.repository_id,
            name: entry.repository_name,
            full_name: entry.repository_full_name,
          },
          new_property_values: propertiesOf(entry),
          old_property_values: propertiesOf(previous),
          ...meta,
        },
        `${stamp}:updated`,
      );
    });
  },
};
