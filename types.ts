// ═══════════════════════════════════════════════════════════════
// Общие типы для tiny-agent
// ═══════════════════════════════════════════════════════════════

export type Message = { role: 'system' | 'user' | 'assistant'; content: string };

export interface ToolCallRecord {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface ReActState {
  step: number;
  emptySteps: number;
  consecutiveReads: number;
  filesCreated: string[];
  filesRead: string[];
  lastReadStep: number;
  toolCalls: ToolCallRecord[];
}

export interface Strategy {
  apply(history: Message[], state: ReActState): void | Message;
}
export type ToolFunction = (args: Record<string, unknown>) => Promise<string> | string;
