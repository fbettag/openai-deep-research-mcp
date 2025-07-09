#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OpenAI from "openai";

// Types and interfaces
interface ResearchRequest {
  id: string;
  query: string;
  systemMessage?: string;
  model: string;
  status: "pending" | "completed" | "failed";
  response?: any;
  error?: string;
  createdAt: Date;
}

interface Citation {
  id: number;
  title: string;
  url?: string;
  snippet?: string;
}

// Global storage for research requests (in production, use a proper database)
const researchRequests = new Map<string, ResearchRequest>();

// Initialize OpenAI client
function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
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
  request_id: z.string().min(1).describe("The ID of the research request to check"),
});

const getResultsSchema = z.object({
  request_id: z.string().min(1).describe("The ID of the research request"),
});

// Tool: Create Research Request
server.registerTool(
  "openai_deep_research_create",
  {
    title: "Create OpenAI Deep Research Request",
    description: "Create a new OpenAI Deep Research request. This initiates a comprehensive research task that can take 5-30 minutes to complete. The AI will decompose your query, perform web searches, and synthesize results into a detailed report with citations.",
    inputSchema: createRequestSchema,
  },
  async (inputs) => {
    try {
      const { query, system_message, model, include_code_interpreter } = inputs;
      const client = getOpenAIClient();
      
      // Generate request ID
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
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
      
      // Store request
      const request: ResearchRequest = {
        id: requestId,
        query,
        systemMessage: system_message,
        model,
        status: "pending",
        response,
        createdAt: new Date(),
      };
      researchRequests.set(requestId, request);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            request_id: requestId,
            status: "pending",
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
    inputSchema: checkStatusSchema,
  },
  async (inputs) => {
    try {
      const { request_id } = inputs;
      
      const request = researchRequests.get(request_id);
      if (!request) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: `Request ID ${request_id} not found`,
              status: "not_found",
            }, null, 2),
          }],
        };
      }
      
      // In a real implementation, you'd check the actual status of the async request
      // For now, we'll simulate by checking if enough time has passed
      const elapsedMinutes = (Date.now() - request.createdAt.getTime()) / 1000 / 60;
      if (elapsedMinutes > 5 && request.status === "pending") {
        request.status = "completed";
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            request_id: request.id,
            status: request.status,
            query: request.query,
            model: request.model,
            created_at: request.createdAt.toISOString(),
            elapsed_minutes: Math.round(elapsedMinutes),
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
    inputSchema: getResultsSchema,
  },
  async (inputs) => {
    try {
      const { request_id } = inputs;
      
      const request = researchRequests.get(request_id);
      if (!request) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: `Request ID ${request_id} not found`,
              status: "not_found",
            }, null, 2),
          }],
        };
      }
      
      if (request.status !== "completed") {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: `Request ${request_id} is not completed. Status: ${request.status}`,
              status: request.status,
            }, null, 2),
          }],
        };
      }
      
      const response = request.response;
      if (!response?.output) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "No results available",
              status: "error",
            }, null, 2),
          }],
        };
      }
      
      // Extract main content
      const mainContent = response.output[response.output.length - 1]?.content?.[0];
      if (!mainContent) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Unable to extract results from response",
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
            request_id: request.id,
            status: "completed",
            query: request.query,
            model: request.model,
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
          }, null, 2),
        }],
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  
  console.error("OpenAI Deep Research MCP Server starting...");
  
  try {
    // Test OpenAI client initialization
    getOpenAIClient();
    console.error("OpenAI client initialized successfully");
  } catch (error) {
    console.error("Warning: OpenAI client initialization failed:", error);
    console.error("Make sure OPENAI_API_KEY is set in your environment");
  }
  
  await server.connect(transport);
  console.error("Server started and listening for connections");
}

// Handle errors
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Run the server
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});