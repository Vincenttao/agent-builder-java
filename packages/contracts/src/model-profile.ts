export interface RuntimeModelProfile {
  executionMode: 'live-mock' | 'simulated' | 'unverified'; digest: string;
  model: { provider: 'OpenAI'; baseUrl: string; name: 'deepseek-v4-flash'; temperature: 0; maxTokens: 1024; thinking: 'disabled' };
}
