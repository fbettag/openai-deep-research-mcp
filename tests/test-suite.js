#!/usr/bin/env node
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

const TEST_TIMEOUT = 300000; // 5 minutes for deep research

class MCPTester {
  constructor() {
    this.serverProcess = null;
    this.testResults = [];
  }

  async startServer() {
    console.log('Starting MCP server...');
    
    this.serverProcess = spawn('node', ['../dist/server.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.TEST_OPENAI_API_KEY
      }
    });

    return new Promise((resolve, reject) => {
      let output = '';
      
      this.serverProcess.stdout.on('data', (data) => {
        output += data.toString();
        if (output.includes('Server started')) {
          resolve();
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        const message = data.toString();
        console.error('Server stderr:', message);
        if (message.includes('listening for connections')) {
          resolve();
        }
      });

      setTimeout(() => {
        if (!output.includes('Server started')) {
          resolve(); // Assume it started
        }
      }, 2000);

      this.serverProcess.on('error', reject);
    });
  }

  async sendMCPRequest(method, params = {}) {
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    };

    return new Promise((resolve, reject) => {
      let response = '';
      
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout for ${method}`));
      }, TEST_TIMEOUT);

      const dataHandler = (data) => {
        response += data.toString();
        try {
          const lines = response.split('\n').filter(line => line.trim());
          for (const line of lines) {
            if (line.trim()) {
              const parsed = JSON.parse(line);
              if (parsed.id === request.id) {
                clearTimeout(timeout);
                this.serverProcess.stdout.removeListener('data', dataHandler);
                resolve(parsed);
                return;
              }
            }
          }
        } catch (e) {
          // Continue collecting data
        }
      };

      this.serverProcess.stdout.on('data', dataHandler);
      this.serverProcess.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async test(name, testFn) {
    console.log(`\n🧪 Running test: ${name}`);
    
    try {
      const result = await testFn();
      console.log(`✅ ${name}: PASSED`);
      this.testResults.push({ name, status: 'PASSED', result });
      return result;
    } catch (error) {
      console.log(`❌ ${name}: FAILED`);
      console.log(`   Error: ${error.message}`);
      this.testResults.push({ name, status: 'FAILED', error: error.message });
      throw error;
    }
  }

  async cleanup() {
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
  }

  async runAllTests() {
    try {
      await this.startServer();
      
      // Test 1: List available tools
      await this.test('List Tools', async () => {
        const response = await this.sendMCPRequest('tools/list');
        if (!response.result || !response.result.tools) {
          throw new Error('No tools returned');
        }
        
        const toolNames = response.result.tools.map(tool => tool.name);
        const expectedTools = [
          'openai_deep_research_create',
          'openai_deep_research_check_status', 
          'openai_deep_research_get_results'
        ];
        
        for (const tool of expectedTools) {
          if (!toolNames.includes(tool)) {
            throw new Error(`Missing tool: ${tool}`);
          }
        }
        
        return response.result;
      });

      // Test 2: Create research request
      let requestId;
      await this.test('Create Research Request', async () => {
        const response = await this.sendMCPRequest('tools/call', {
          name: 'openai_deep_research_create',
          arguments: {
            query: 'What is 2+2? Give a very brief answer.',
            model: 'o4-mini-deep-research-2025-06-26'
          }
        });
        
        if (!response.result || !response.result.content) {
          throw new Error('No content in response');
        }
        
        const content = JSON.parse(response.result.content[0].text);
        if (!content.request_id) {
          throw new Error('No request_id in response');
        }
        
        if (content.status !== 'pending') {
          throw new Error(`Expected status 'pending', got '${content.status}'`);
        }
        
        requestId = content.request_id;
        return content;
      });

      // Test 3: Check status
      await this.test('Check Request Status', async () => {
        const response = await this.sendMCPRequest('tools/call', {
          name: 'openai_deep_research_check_status',
          arguments: {
            request_id: requestId
          }
        });
        
        if (!response.result || !response.result.content) {
          throw new Error('No content in response');
        }
        
        const content = JSON.parse(response.result.content[0].text);
        if (!content.request_id || content.request_id !== requestId) {
          throw new Error('Request ID mismatch');
        }
        
        if (!['pending', 'completed', 'failed'].includes(content.status)) {
          throw new Error(`Invalid status: ${content.status}`);
        }
        
        return content;
      });

      // Test 4: Wait for completion and get results
      await this.test('Get Research Results', async () => {
        // Poll for completion
        let attempts = 0;
        let statusResponse;
        
        while (attempts < 30) { // Max 5 minutes
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
          
          statusResponse = await this.sendMCPRequest('tools/call', {
            name: 'openai_deep_research_check_status',
            arguments: { request_id: requestId }
          });
          
          const statusContent = JSON.parse(statusResponse.result.content[0].text);
          console.log(`   Status check ${attempts + 1}: ${statusContent.status}`);
          
          if (statusContent.status === 'completed') {
            break;
          } else if (statusContent.status === 'failed') {
            throw new Error('Research request failed');
          }
          
          attempts++;
        }
        
        if (attempts >= 30) {
          throw new Error('Request did not complete within timeout');
        }
        
        // Get results
        const response = await this.sendMCPRequest('tools/call', {
          name: 'openai_deep_research_get_results',
          arguments: {
            request_id: requestId
          }
        });
        
        if (!response.result || !response.result.content) {
          throw new Error('No content in response');
        }
        
        const content = JSON.parse(response.result.content[0].text);
        
        if (content.error) {
          throw new Error(`Error getting results: ${content.error}`);
        }
        
        if (!content.results || !content.results.report) {
          throw new Error('No report in results');
        }
        
        console.log(`   📝 Report preview: ${content.results.report.substring(0, 100)}...`);
        
        return content;
      });

      console.log('\n🎉 All tests passed!');
      
    } catch (error) {
      console.log(`\n💥 Test suite failed: ${error.message}`);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  printSummary() {
    console.log('\n📊 Test Summary:');
    for (const result of this.testResults) {
      console.log(`   ${result.status === 'PASSED' ? '✅' : '❌'} ${result.name}`);
    }
  }
}

// Check for API key
if (!process.env.OPENAI_API_KEY && !process.env.TEST_OPENAI_API_KEY) {
  console.error('❌ Error: OPENAI_API_KEY or TEST_OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

// Run tests
const tester = new MCPTester();
tester.runAllTests().then(() => {
  tester.printSummary();
}).catch(error => {
  console.error('Test suite error:', error);
  tester.printSummary();
  process.exit(1);
});