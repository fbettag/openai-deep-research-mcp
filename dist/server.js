#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OpenAI from "openai";
// Global storage for research requests (in production, use a proper database)
const researchRequests = new Map();
// Initialize OpenAI client
function getOpenAIClient() {
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
server.registerTool("openai_deep_research_create", {
    title: "Create OpenAI Deep Research Request",
    description: "Create a new OpenAI Deep Research request. This initiates a comprehensive research task that can take 5-30 minutes to complete. The AI will decompose your query, perform web searches, and synthesize results into a detailed report with citations.",
    inputSchema: createRequestSchema.shape,
}, async (inputs) => {
    try {
        const { query, system_message, model, include_code_interpreter } = inputs;
        const client = getOpenAIClient();
        // Generate request ID
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        // Build input messages
        const inputMessages = [];
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
        const tools = [{ type: "web_search_preview" }];
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
        // Store request with OpenAI response ID
        const request = {
            id: requestId,
            query,
            systemMessage: system_message,
            model,
            status: "pending",
            openaiResponseId: response.id,
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
    }
    catch (error) {
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
});
// Tool: Check Status
server.registerTool("openai_deep_research_check_status", {
    title: "Check Research Request Status",
    description: "Check the status of an OpenAI Deep Research request",
    inputSchema: checkStatusSchema.shape,
}, async (inputs) => {
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
        // Check the actual status from OpenAI
        if (request.openaiResponseId && request.status === "pending") {
            try {
                const client = getOpenAIClient();
                const response = await client.responses.retrieve(request.openaiResponseId);
                if (response.status === "completed") {
                    request.status = "completed";
                    request.response = response;
                }
                else if (response.status === "failed") {
                    request.status = "failed";
                    request.error = "Research request failed";
                }
            }
            catch (error) {
                console.error("Error checking status:", error);
            }
        }
        const elapsedMinutes = (Date.now() - request.createdAt.getTime()) / 1000 / 60;
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
    }
    catch (error) {
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
});
// Tool: Get Results
server.registerTool("openai_deep_research_get_results", {
    title: "Get Research Results",
    description: "Get the results from a completed OpenAI Deep Research request",
    inputSchema: getResultsSchema.shape,
}, async (inputs) => {
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
        let response = request.response;
        // For background requests, we need to retrieve the completed response
        if (request.openaiResponseId && (!response || !response.output)) {
            try {
                const client = getOpenAIClient();
                const fullResponse = await client.responses.retrieve(request.openaiResponseId);
                request.response = fullResponse;
                response = fullResponse;
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                error: `Failed to retrieve results: ${error instanceof Error ? error.message : String(error)}`,
                                status: "error",
                            }, null, 2),
                        }],
                };
            }
        }
        if (!response) {
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
        const lastMessage = output[output.length - 1];
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
        const mainContent = lastMessage.content[0];
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
        const citations = [];
        if (mainContent.annotations) {
            mainContent.annotations.forEach((annotation, index) => {
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
    }
    catch (error) {
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
});
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    console.error("OpenAI Deep Research MCP Server starting...");
    try {
        // Test OpenAI client initialization
        getOpenAIClient();
        console.error("OpenAI client initialized successfully");
    }
    catch (error) {
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
//# sourceMappingURL=server.js.map