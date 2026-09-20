"use client";
import { memo, useMemo } from "react";
import { CoachVisuals } from "./coach-visuals";
import type { SavedVisual } from "@/lib/coach-visuals";
import {
  AGUI_ROUTE_MAP_COMPONENT,
  AGUI_ROUTE_MAP_TOOL,
} from "@/lib/agui-components";

export const AguiRouteMap = memo(function AguiRouteMap({
  visual,
  accountId,
}: {
  visual: SavedVisual;
  accountId: string;
}) {
  const visuals = useMemo(() => [visual], [visual]);
  return (
    <div data-agui-component="route_map" data-agui-tool="plan_route">
      <CoachVisuals visuals={visuals} accountId={accountId} />
    </div>
  );
});

export const aguiComponents = {
  [AGUI_ROUTE_MAP_TOOL]: AguiRouteMap,
  [AGUI_ROUTE_MAP_COMPONENT]: AguiRouteMap,
} as const;

export const AguiVisuals = memo(function AguiVisuals({
  visuals,
  accountId,
}: {
  visuals: SavedVisual[];
  accountId: string;
}) {
  return (
    <>
      {visuals.map((visual) => {
        const Component =
          visual.content.kind === "route_map"
            ? aguiComponents[AGUI_ROUTE_MAP_COMPONENT]
            : null;
        return Component ? (
          <Component
            key={visual.id}
            visual={visual}
            accountId={accountId}
          />
        ) : (
          <CoachVisuals
            key={visual.id}
            visuals={[visual]}
            accountId={accountId}
          />
        );
      })}
    </>
  );
});
