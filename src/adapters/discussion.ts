import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { DISCUSSIONS_PATH, observe, repoAndSender } from "./common.ts";

const labelNames = (discussion: any): string[] =>
  (discussion.labels ?? []).map((label: any) => label.name).sort();

function stateOf(discussion: any): string {
  const body = sha256(`${discussion.title}\n${discussion.body ?? ""}`);
  return [
    discussion.state,
    discussion.state_reason ?? "",
    discussion.locked,
    discussion.answer_chosen_at ?? "",
    discussion.category?.id ?? "",
    labelNames(discussion).join(","),
    body,
  ].join(":");
}

function actionsFor(previous: any, current: any): string[] {
  if (!previous) return ["created"];
  const actions: string[] = [];
  if (previous.state !== current.state) {
    actions.push(current.state === "closed" ? "closed" : "reopened");
  }
  if (previous.locked !== current.locked) actions.push(current.locked ? "locked" : "unlocked");
  if (Boolean(previous.answer_chosen_at) !== Boolean(current.answer_chosen_at)) {
    actions.push(current.answer_chosen_at ? "answered" : "unanswered");
  }
  if (previous.category?.id !== current.category?.id) actions.push("category_changed");
  const before = labelNames(previous);
  const after = labelNames(current);
  if (after.some((name) => !before.includes(name))) actions.push("labeled");
  if (before.some((name) => !after.includes(name))) actions.push("unlabeled");
  if (`${previous.title}\n${previous.body}` !== `${current.title}\n${current.body}`) {
    actions.push("edited");
  }
  return actions;
}

export const discussion: Adapter = {
  name: "discussion",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/${DISCUSSIONS_PATH}`, {
      etagKey: `discussions:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const item of result.data) {
      const state = stateOf(item);
      const { changed, prev } = observe(ctx, "discussion", String(item.number), state, item);
      if (!changed) continue;
      for (const action of actionsFor(prev?.data, item)) {
        const changes =
          action === "category_changed"
            ? { changes: { category: { from: prev?.data.category } } }
            : {};
        ctx.emit(
          "discussion",
          action,
          String(item.number),
          {
            action,
            discussion: item,
            ...changes,
            repository: meta.repository,
            sender: meta.sender,
          },
          `${state}:${action}`,
        );
      }
    }
  },
};
