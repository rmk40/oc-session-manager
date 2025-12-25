// Single instance row component

import React, { useContext } from "react";
import { Text, Box } from "ink";
import { useSessionHelpers, useViewState } from "./AppContext.js";
import { SpinnerContext } from "./App.js";
import type { Instance } from "../types.js";
import {
  formatDuration,
  formatRelativeTime,
  formatCost,
  formatTokens,
} from "../utils.js";

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface InstanceRowProps {
  instance: Instance;
  isSelected: boolean;
  indent?: number;
  showProject?: boolean;
  treePrefix?: string; // Tree line prefix like '├─' or '└─'
}

const StatusIndicator = React.memo(({ instance }: { instance: Instance }) => {
  const { getSessionStatus, isSessionLongRunning } = useSessionHelpers();
  const spinnerFrame = useContext(SpinnerContext);

  const status = getSessionStatus(instance.instanceId);
  const longRunning = isSessionLongRunning(instance.instanceId);

  if (status === "disconnected") return <Text color="gray">◌</Text>;
  if (status === "pending") return <Text color="yellow">◆</Text>;
  if (status === "idle") return <Text color="green">●</Text>;
  if (status === "busy") {
    if (longRunning) return <Text color="red">!</Text>;
    return (
      <Text color="yellow">
        {SPINNER_CHARS[spinnerFrame % SPINNER_CHARS.length]}
      </Text>
    );
  }
  return <Text color="gray">◌</Text>;
});

const RelativeTime = React.memo(({ instance }: { instance: Instance }) => {
  const { getSessionStatus, getSessionBusyDuration } = useSessionHelpers();
  const status = getSessionStatus(instance.instanceId);
  const busyDuration = getSessionBusyDuration(instance.instanceId);
  const timeStr =
    status === "busy" || status === "pending"
      ? formatDuration(busyDuration)
      : formatRelativeTime(instance.ts);
  return <Text dimColor>{timeStr.padStart(8)}</Text>;
});

export const InstanceRow = React.memo(
  ({
    instance,
    isSelected,
    indent = 0,
    showProject = false,
    treePrefix,
  }: InstanceRowProps): React.ReactElement => {
    const { terminalSize } = useViewState();
    const width = terminalSize.columns;
    const { getSessionStatus } = useSessionHelpers();
    const status = getSessionStatus(instance.instanceId);

    const shortSession = instance.sessionID?.slice(-4) ?? "----";
    const costStr = formatCost(instance.cost);
    const tokStr = formatTokens(instance.tokens?.total);

    let maxTitleWidth = 40;
    if (width > 120) maxTitleWidth = width - 80;
    else if (width > 100) maxTitleWidth = width - 60;

    const title = instance.title || `[${status.toUpperCase()}]`;
    const truncatedTitle =
      title.length > maxTitleWidth
        ? title.slice(0, maxTitleWidth - 3) + "..."
        : title;
    const prefix = showProject
      ? `${instance.dirName || "?"}:${instance.branch || "?"}:`
      : "";

    // Adjust indent when tree prefix is present
    const baseIndent = Math.max(0, indent - 2 - (treePrefix ? 3 : 0));

    return (
      <Box>
        <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
          {" ".repeat(baseIndent)}
          {isSelected ? "➔ " : "  "}
          {treePrefix ? <Text dimColor>{treePrefix} </Text> : null}
          <StatusIndicator instance={instance} /> {prefix}
          {shortSession}
          {"  "}
          <Text dimColor={!isSelected}>"{truncatedTitle}"</Text>
        </Text>

        {width > 110 && instance.model ? (
          <Text dimColor> [{instance.model}]</Text>
        ) : null}

        <Box flexGrow={1} />

        <Box>
          {costStr ? <Text color="magenta"> {costStr}</Text> : null}
          {tokStr ? <Text color="magenta"> {tokStr}</Text> : null}
          {width > 130 && instance.tokens ? (
            <Text dimColor>
              {" "}
              ({instance.tokens.input}i/{instance.tokens.output}o)
            </Text>
          ) : null}
          <Text>{"  "}</Text>
          <RelativeTime instance={instance} />
        </Box>
      </Box>
    );
  },
);
