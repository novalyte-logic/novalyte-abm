/**
 * Amazon Bedrock Service — Claude & Mistral via Bedrock Runtime API
 * Uses Bedrock API Key (Bearer token) for authentication.
 *
 * Model routing:
 * - Claude Sonnet 4 → complex reasoning: email personalization, competitor intel, scoring logic
 * - Claude Haiku 3.5 → fast structured extraction: people/email parsing, classification
 * - Mistral Large → fallback / second opinion for ambiguous cases
 */
import axios from 'axios';

const getEnv = (key: string): string => {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env)
    ? (import.meta as any).env : {};
  return metaEnv?.[key] || '';
};

export type BedrockModel =
  | 'anthropic.claude-opus-4-20250514-v1:0'
  | 'anthropic.claude-sonnet-4-20250514-v1:0'
  | 'anthropic.claude-3-5-haiku-20241022-v1:0'
  | 'anthropic.claude-3-5-sonnet-20241022-v2:0'
  | 'mistral.mistral-large-2407-v1:0';

// Friendly aliases
export const MODELS = {
  CLAUDE_OPUS: 'anthropic.claude-opus-4-20250514-v1:0' as BedrockModel,
  CLAUDE_SONNET: 'anthropic.claude-sonnet-4-20250514-v1:0' as BedrockModel,
  CLAUDE_HAIKU: 'anthropic.claude-3-5-haiku-20241022-v1:0' as BedrockModel,
  CLAUDE_SONNET_35: 'anthropic.claude-3-5-sonnet-20241022-v2:0' as BedrockModel,
  MISTRAL_LARGE: 'mistral.mistral-large-2407-v1:0' as BedrockModel,
};

interface BedrockRequest {
  prompt: string;
  model?: BedrockModel;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

interface BedrockResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

class BedrockService {
  private apiKey: string;
  private region: string;

  constructor() {
    this.apiKey = getEnv('VITE_BEDROCK_API_KEY');
    this.region = getEnv('VITE_AWS_REGION') || 'us-east-1';
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  private get baseUrl(): string {
    return `https://bedrock-runtime.${this.region}.amazonaws.com`;
  }

  /**
   * Call Bedrock Converse API
   */
  async converse(req: BedrockRequest): Promise<BedrockResponse> {
    const model = req.model || MODELS.CLAUDE_SONNET;
    const url = `${this.baseUrl}/model/${encodeURIComponent(model)}/converse`;

    const body: any = {
      messages: [
        { role: 'user', content: [{ text: req.prompt }] },
      ],
      inferenceConfig: {
        temperature: req.temperature ?? 0.3,
        maxTokens: req.maxTokens ?? 2048,
      },
    };

    if (req.systemPrompt) {
      body.system = [{ text: req.systemPrompt }];
    }

    const response = await axios.post(url, body, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    const data = response.data;
    const text = data?.output?.message?.content?.[0]?.text || '';

    return {
      text,
      model,
      inputTokens: data?.usage?.inputTokens || 0,
      outputTokens: data?.usage?.outputTokens || 0,
      stopReason: data?.stopReason || 'unknown',
    };
  }

  /** Parse JSON from response text */
  parseJSON<T = any>(text: string): T | null {
    try {
      // Try direct parse first
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return JSON.parse(trimmed);
      }
      // Extract JSON from markdown code blocks or mixed text
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
      return null;
    } catch {
      return null;
    }
  }

  /** Generate + parse JSON in one call */
  async generateJSON<T = any>(req: BedrockRequest): Promise<T | null> {
    const response = await this.converse(req);
    return this.parseJSON<T>(response.text);
  }

  /** Generate plain text */
  async generateText(req: BedrockRequest): Promise<string> {
    const response = await this.converse(req);
    return response.text;
  }
}

export const bedrockService = new BedrockService();