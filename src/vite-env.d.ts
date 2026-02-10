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

// Google Maps types
declare namespace google.maps {
  class Map {
    constructor(element: HTMLElement, options: MapOptions);
  }
  interface MapOptions {
    center: { lat: number; lng: number };
    zoom: number;
    styles?: any[];
    disableDefaultUI?: boolean;
    zoomControl?: boolean;
    mapTypeControl?: boolean;
    streetViewControl?: boolean;
    fullscreenControl?: boolean;
    backgroundColor?: string;
  }
  class Marker {
    constructor(options: MarkerOptions);
    addListener(event: string, handler: () => void): void;
  }
  interface MarkerOptions {
    position: { lat: number; lng: number };
    map: Map;
    icon?: any;
    title?: string;
  }
  class InfoWindow {
    constructor(options: { content: string });
    open(map: Map, marker: Marker): void;
  }
  const SymbolPath: {
    CIRCLE: number;
  };
  namespace marker {
    class AdvancedMarkerElement {
      constructor(options: { map: Map; position: { lat: number; lng: number }; content: HTMLElement; title?: string });
      map: Map | null;
    }
  }
}
