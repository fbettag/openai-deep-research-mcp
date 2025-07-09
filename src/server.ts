#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OpenAI from "openai";

// Types and interfaces
interface Citation {
  id: number;
  title: string;
  url?: string;
  snippet?: string;
}

// Initialize OpenAI client
function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required. Please set it in your environment or MCP configuration.");
  }
  
  const timeout = parseInt(process.env.OPENAI_TIMEOUT || "600000", 10);
  
  return new OpenAI({
    apiKey,
    timeout,
    baseURL: process.env.OPENAI_BASE_URL,
  });
}

// Initialize MCP server
const server = new McpServer({
  name: "openai-deep-research",
  version: "1.0.0",
});

// Input schemas using Zod
const createRequestSchema = z.object({
  query: z.string().min(1).describe("The research question or topic to investigate"),
  system_message: z.string().optional().describe("Optional system message to guide the research approach"),
  model: z.enum(["o3-deep-research-2025-06-26", "o4-mini-deep-research-2025-06-26"])
    .default("o3-deep-research-2025-06-26")
    .describe("The model to use for research. o3-deep-research-2025-06-26: Full research model optimized for in-depth synthesis and higher quality (5-30 minutes). o4-mini-deep-research-2025-06-26: Lightweight and faster model, ideal for quick research or latency-sensitive use cases."),
  include_code_interpreter: z.boolean().default(false)
    .describe("Whether to include code interpreter tool for data analysis and calculations"),
});

const checkStatusSchema = z.object({
  request_id: z.string().min(1).describe("The OpenAI response ID to check (starts with 'resp_')"),
});

const getResultsSchema = z.object({
  request_id: z.string().min(1).describe("The OpenAI response ID (starts with 'resp_')"),
});

// Tool: Create Research Request
server.registerTool(
  "openai_deep_research_create",
  {
    title: "Create OpenAI Deep Research Request",
    description: "Create a new OpenAI Deep Research request. This initiates a comprehensive research task that can take 5-30 minutes to complete. The AI will decompose your query, perform web searches, and synthesize results into a detailed report with citations.",
    inputSchema: createRequestSchema.shape,
  },
  async (inputs) => {
    try {
      const { query, system_message, model, include_code_interpreter } = inputs;
      
      // Initialize OpenAI client (lazy loading)
      let client;
      try {
        client = getOpenAIClient();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: errorMessage,
              status: "configuration_error",
              help: "Please ensure OPENAI_API_KEY is set in your environment or MCP configuration"
            }, null, 2),
          }],
        };
      }
      
      
      // Build input messages
      const inputMessages: any[] = [];
      
      if (system_message) {
        inputMessages.push({
          role: "developer",
          content: [{
            type: "input_text",
            text: system_message,
          }],
        });
      }
      
      inputMessages.push({
        role: "user",
        content: [{
          type: "input_text",
          text: query,
        }],
      });
      
      // Build tools list
      const tools: any[] = [{ type: "web_search_preview" }];
      if (include_code_interpreter) {
        tools.push({ type: "code_interpreter" });
      }
      
      // Create research request
      const response = await client.responses.create({
        model,
        input: inputMessages,
        reasoning: { summary: "auto" },
        tools,
        background: true,
      });
      
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            request_id: response.id,
            status: response.status,
            message: "Research request created successfully",
          }, null, 2),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Failed to create research request: ${errorMessage}`,
            status: "failed",
            help: "Check your OpenAI API key and network connection"
          }, null, 2),
        }],
      };
    }
  }
);

// Tool: Check Status
server.registerTool(
  "openai_deep_research_check_status",
  {
    title: "Check Research Request Status",
    description: "Check the status of an OpenAI Deep Research request",
    inputSchema: checkStatusSchema.shape,
  },
  async (inputs) => {
    try {
      const { request_id } = inputs;
      
      // Initialize OpenAI client (lazy loading)
      let client;
      try {
        client = getOpenAIClient();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: errorMessage,
              status: "configuration_error",
              help: "Please ensure OPENAI_API_KEY is set in your environment or MCP configuration"
            }, null, 2),
          }],
        };
      }
      
      // Retrieve status directly from OpenAI
      const response = await client.responses.retrieve(request_id);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            request_id: response.id,
            status: response.status,
            model: response.model,
            created_at: new Date(response.created_at * 1000).toISOString(),
          }, null, 2),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Failed to check status: ${errorMessage}`,
            status: "error",
            help: "Check your OpenAI API key and network connection, or verify the request_id is valid"
          }, null, 2),
        }],
      };
    }
  }
);

// Tool: Get Results
server.registerTool(
  "openai_deep_research_get_results",
  {
    title: "Get Research Results",
    description: "Get the results from a completed OpenAI Deep Research request",
    inputSchema: getResultsSchema.shape,
  },
  async (inputs) => {
    try {
      const { request_id } = inputs;
      
      // Initialize OpenAI client (lazy loading)
      let client;
      try {
        client = getOpenAIClient();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: errorMessage,
              status: "configuration_error",
              help: "Please ensure OPENAI_API_KEY is set in your environment or MCP configuration"
            }, null, 2),
          }],
        };
      }
      
      // Retrieve response directly from OpenAI
      const response = await client.responses.retrieve(request_id);
      
      if (response.status !== "completed") {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: `Request ${request_id} is not completed. Status: ${response.status}`,
              status: response.status,
            }, null, 2),
          }],
        };
      }
      
      // Extract output array
      const output = response.output;
      if (!output || !Array.isArray(output) || output.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "No output available in response",
              status: "error",
              debug: {
                hasResponse: !!response,
                hasOutput: !!output,
                outputType: typeof output,
                outputLength: Array.isArray(output) ? output.length : 'not array',
              },
            }, null, 2),
          }],
        };
      }
      
      // Get the last message from output array (should be the assistant's response)
      const lastMessage = output[output.length - 1] as any;
      if (!lastMessage || !lastMessage.content || !Array.isArray(lastMessage.content)) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Unable to extract content from last message",
              status: "error",
              debug: {
                lastMessageKeys: lastMessage ? Object.keys(lastMessage) : 'no last message',
                hasContent: !!(lastMessage && lastMessage.content),
              },
            }, null, 2),
          }],
        };
      }
      
      // Get the main content (first content item)
      const mainContent = lastMessage.content[0] as any;
      if (!mainContent) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "No content in last message",
              status: "error",
            }, null, 2),
          }],
        };
      }
      
      // Extract citations
      const citations: Citation[] = [];
      if (mainContent.annotations) {
        mainContent.annotations.forEach((annotation: any, index: number) => {
          citations.push({
            id: index + 1,
            title: annotation.title || "Unknown",
            url: annotation.url,
            snippet: annotation.snippet,
          });
        });
      }
      
      // Get report text
      const reportText = mainContent.text || String(mainContent);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            request_id: response.id,
            status: "completed",
            model: response.model,
            results: {
              report: reportText,
              citations,
              citation_count: citations.length,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Failed to get results: ${errorMessage}`,
            status: "error",
            help: "Check your OpenAI API key and network connection, or verify the request_id is valid and completed"
          }, null, 2),
        }],
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Handle process signals for graceful shutdown
process.on("SIGINT", () => {
  process.exit(0);
});

process.on("SIGTERM", () => {
  process.exit(0);
});

// Handle errors gracefully
// We don't exit on these errors to maintain server availability
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

// Run the server
main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});