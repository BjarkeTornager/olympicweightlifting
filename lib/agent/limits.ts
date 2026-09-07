// A provider may suggest a large parallel batch. Accept its bounded envelope
// so the engine can request a smaller batch without executing excess tools.
export const MAX_PROVIDER_TOOL_CALLS = 32;
export const MAX_EXECUTED_TOOLS = 10;
