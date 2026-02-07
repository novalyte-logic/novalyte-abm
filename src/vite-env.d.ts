/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_PLACES_API_KEY: string;
  readonly VITE_GOOGLE_API_KEY: string;
  readonly VITE_SERPAPI_KEY: string;
  readonly VITE_APOLLO_API_KEY: string;
  readonly VITE_CLEARBIT_API_KEY: string;
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_EXA_API_KEY: string;
  readonly VITE_REVENUEBASE_API_KEY: string;
  readonly VITE_VAPI_API_KEY: string;
  readonly VITE_VAPI_PUBLIC_KEY: string;
  readonly VITE_VAPI_PHONE_NUMBER_ID: string;
  readonly VITE_VAPI_PHONE_NUMBER: string;
  readonly VITE_VAPI_ASSISTANT_ID: string;
  readonly VITE_BLAND_AI_API_KEY: string;
  // Google Cloud / Vertex AI
  readonly VITE_GCP_PROJECT_ID: string;
  readonly VITE_GCP_LOCATION: string;
  readonly VITE_GCP_ACCESS_TOKEN: string;
  // Supabase
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
