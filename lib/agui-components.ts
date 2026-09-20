import { EventType } from "@ag-ui/core";
import { savedVisualSchema, type SavedVisual } from "./coach-visuals";
import type { EmitCoachEvent } from "./agent/stream";

export const AGUI_ROUTE_MAP_TOOL = "plan_route";
export const AGUI_ROUTE_MAP_COMPONENT = "route_map";

export function visualFromAguiPayload(value: unknown): SavedVisual | undefined {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return;
    }
  }
  const parsed = savedVisualSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function emitDisplayedVisual(
  emit: EmitCoachEvent | undefined,
  visual: SavedVisual,
  toolName = AGUI_ROUTE_MAP_TOOL,
) {
  if (!emit) return;
  emit({ type: EventType.CUSTOM, name: "coach.visual", value: visual });
  if (visual.content.kind !== "route_map") return;
  const toolCallId = visual.id;
  emit({
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName: toolName,
  });
  emit({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: JSON.stringify(visual),
  });
  emit({ type: EventType.TOOL_CALL_END, toolCallId });
  emit({
    type: EventType.TOOL_CALL_RESULT,
    toolCallId,
    messageId: visual.id,
    content: JSON.stringify(visual),
    role: "tool",
  });
  emit({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: visual.id,
    activityType: AGUI_ROUTE_MAP_COMPONENT,
    content: visual as unknown as Record<string, unknown>,
    replace: true,
  });
}
