/**
 * Google Cloud Vertex AI Service
 * Unified interface for all Gemini model calls.
 *
 * Routing priority:
 * 1. Vertex AI (GCP_PROJECT_ID + GCP_ACCESS_TOKEN) — full Vertex AI endpoint
 * 2. Gemini API key (GEMINI_API_KEY) — works with all Gemini models, no GCP needed
 *
 * For a frontend app, the Gemini API key approach is simpler and doesn't expire.
 * Vertex AI endpoint is available when you need GCP-specific features (grounding,
 * model garden, custom endpoints, etc.)
 */
import axios from 'axios';

const getEnv = (key: string): string => {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env)
    ? (import.meta as any).env : {};
  return metaEnv?.[key] || '';
};

export type GeminiModel =
  | 'gemini-2.0-flash'
  | 'gemini-2.5-flash-preview-05-20'
  | 'gemini-2.5-pro-preview-05-06';

interface GenerateContentRequest {
  prompt: string;
  model?: GeminiModel;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

interface GenerateContentResponse {
  text: string;
  raw: any;
}

class VertexAIService {
  private gcpProjectId: string;
  private gcpLocation: string;
  private geminiApiKey: string;
  private accessToken: string;

  constructor() {
    this.gcpProjectId = getEnv('VITE_GCP_PROJECT_ID');
    this.gcpLocation = getEnv('VITE_GCP_LOCATION') || 'us-central1';
    this.geminiApiKey = getEnv('VITE_GEMINI_API_KEY');
    this.accessToken = getEnv('VITE_GCP_ACCESS_TOKEN');
  }

  get isVertexAI(): boolean {
    return !!(this.gcpProjectId && this.accessToken);
  }

  get isConfigured(): boolean {
    return !!(this.geminiApiKey || (this.gcpProjectId && this.accessToken));
  }

  get provider(): string {
    if (this.gcpProjectId && this.accessToken) return 'vertex-ai';
    if (this.geminiApiKey) return 'gemini-api';
    return 'none';
  }

  /**
   * Generate content — auto-routes to best available endpoint
   */
  async generateContent(req: GenerateContentRequest): Promise<GenerateContentResponse> {
    const model = req.model || 'gemini-2.0-flash';

    const body: any = {
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.3,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
      },
    };

    if (req.systemInstruction) {
      body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
    }

    // Try Vertex AI first, fall back to Gemini API
    if (this.gcpProjectId && this.accessToken) {
      try {
        return await this.callVertexAI(model, body);
      } catch (err: any) {
        // If 401/403, token likely expired — fall back to Gemini API key
        if (err?.response?.status === 401 || err?.response?.status === 403) {
          console.warn('Vertex AI token expired, falling back to Gemini API key');
          if (this.geminiApiKey) return this.callGeminiAPI(model, body);
        }
        throw err;
      }
    }

    return this.callGeminiAPI(model, body);
  }

  /**
   * Vertex AI endpoint
   */
  private async callVertexAI(model: string, body: any): Promise<GenerateContentResponse> {
    const url = `https://${this.gcpLocation}-aiplatform.googleapis.com/v1/projects/${this.gcpProjectId}/locations/${this.gcpLocation}/publishers/google/models/${model}:generateContent`;

    const response = await axios.post(url, body, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text, raw: response.data };
  }

  /**
   * Gemini API (API key auth)
   */
  private async callGeminiAPI(model: string, body: any): Promise<GenerateContentResponse> {
    if (!this.geminiApiKey) throw new Error('No Gemini API key configured');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`;

    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text, raw: response.data };
  }

  /** Extract JSON from a Gemini response */
  parseJSON<T = any>(text: string): T | null {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  /** Generate + parse JSON in one call */
  async generateJSON<T = any>(req: GenerateContentRequest): Promise<T | null> {
    const response = await this.generateContent(req);
    return this.parseJSON<T>(response.text);
  }
}

export const vertexAI = new VertexAIService();
