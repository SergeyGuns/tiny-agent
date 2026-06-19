// ─── MCP Client — connects to web-search-mcp server via stdio ──
// Implements the MCP (Model Context Protocol) JSON-RPC 2.0 transport over stdio.

import { spawn, ChildProcess } from 'node:child_process';
import { ToolFunction } from '../types.js';

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

interface McpToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export class McpClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private tools: McpTool[] = [];
  private ready = false;
  private buffer = '';

  constructor(
    private command: string,
    private args: string[],
    private env: Record<string, string> = {},
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout!.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            this.handleMessage(msg);
          } catch { /* skip non-JSON lines */ }
        }
      });

      this.process.stderr!.on('data', () => {
        // Suppress stderr from MCP server
      });

      this.process.on('error', (err) => {
        reject(new Error(`MCP process error: ${err.message}`));
      });

      this.process.on('exit', (code) => {
        if (!this.ready) {
          reject(new Error(`MCP process exited with code ${code}`));
        }
      });

      // Initialize the MCP server
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'tiny-agent', version: '1.0.0' },
      }).then(async () => {
        // Send initialized notification
        this.sendNotification('notifications/initialized', {});
        // Fetch tools list
        const toolsResult = await this.sendRequest('tools/list', {});
        this.tools = (toolsResult?.tools || []) as McpTool[];
        this.ready = true;
        resolve();
      }).catch(reject);
    });
  }

  private handleMessage(msg: any): void {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message || 'MCP error'));
      } else {
        resolve(msg.result);
      }
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.process!.stdin!.write(msg + '\n');
      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  private sendNotification(method: string, params: any): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.process!.stdin!.write(msg + '\n');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    }) as McpToolResult;

    if (result.isError) {
      return `MCP tool error: ${result.content?.[0]?.text || 'unknown error'}`;
    }
    return result.content?.map(c => c.text).join('\n') || '(empty result)';
  }

  getTools(): McpTool[] {
    return this.tools;
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

// ─── Singleton MCP client instance ──────────────────────────────

let mcpClient: McpClient | null = null;

export async function getMcpClient(): Promise<McpClient | null> {
  if (mcpClient) return mcpClient;

  const mcpServerPath = process.env.MCP_WEB_SEARCH_PATH || '/home/serg/mcp-servers/web-search-mcp/dist/index.js';

  // Check if the MCP server binary exists
  const fs = await import('node:fs');
  if (!fs.existsSync(mcpServerPath)) {
    console.error(`[MCP] Server not found: ${mcpServerPath}`);
    return null;
  }

  mcpClient = new McpClient('node', [mcpServerPath], {
    BROWSER_HEADLESS: 'true',
    MAX_BROWSERS: '2',
    DEFAULT_TIMEOUT: '10000',
  });

  try {
    await mcpClient.start();
    console.log(`[MCP] Connected: ${mcpClient.getTools().map(t => t.name).join(', ')}`);
    return mcpClient;
  } catch (e) {
    console.error(`[MCP] Failed to start: ${e instanceof Error ? e.message : String(e)}`);
    mcpClient = null;
    return null;
  }
}

// ─── Create tool functions from MCP tools ───────────────────────

export function createMcpToolFunction(client: McpClient, tool: McpTool): ToolFunction {
  return async (args: Record<string, unknown>) => {
    try {
      return await client.callTool(tool.name, args);
    } catch (e) {
      return `MCP ${tool.name} error: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
}

// ─── Convert MCP tool schema to tiny-agent tool schema ──────────

export function mcpToolToSchema(tool: McpTool): object {
  const properties: Record<string, any> = {};
  for (const [key, prop] of Object.entries(tool.inputSchema.properties || {})) {
    properties[key] = {
      type: prop.type,
      description: prop.description || '',
    };
  }
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties,
      required: tool.inputSchema.required || [],
    },
  };
}
