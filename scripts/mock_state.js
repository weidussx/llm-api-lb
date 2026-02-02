const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TARGET = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'state.json');

const state = {
  version: 1,
  rrIndex: 0,
  rrIndexByPool: {},
  keys: [
    {
      id: crypto.randomUUID(),
      name: "Mock OpenAI Primary",
      provider: "openai",
      apiKey: "sk-mock-key-primary-123456",
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-3.5-turbo", "gpt-4", "gpt-4o"],
      weight: 10,
      enabled: true,
      failures: 0,
      cooldownUntil: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      name: "Mock Gemini Backup",
      provider: "gemini",
      apiKey: "AIza-mock-key-backup",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      models: ["gemini-pro"],
      weight: 1,
      enabled: true,
      failures: 0,
      cooldownUntil: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      name: "Mock DeepSeek",
      provider: "deepseek",
      apiKey: "sk-mock-deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      models: ["deepseek-chat"],
      weight: 5,
      enabled: true,
      failures: 0,
      cooldownUntil: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  aiGateway: {
    enabled: false,
    provider: "cloudflare",
    cloudflare: {
        accountId: "",
        gatewayName: "",
        token: "",
        byok: false
    }
  }
};

try {
    fs.mkdirSync(path.dirname(TARGET), { recursive: true });
    fs.writeFileSync(TARGET, JSON.stringify(state, null, 2));
    console.log(`✅ Mock state generated at: ${TARGET}`);
    console.log(`   Contains ${state.keys.length} keys.`);
} catch (err) {
    console.error(`❌ Failed to write mock state: ${err.message}`);
    process.exit(1);
}
