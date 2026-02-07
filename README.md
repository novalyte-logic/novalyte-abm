# Novalyte ABM

Account Based Marketing Platform for targeting men's health clinics in affluent American markets.

## Overview

Novalyte ABM is a comprehensive platform that combines keyword intelligence, clinic discovery, CRM management, and AI-powered voice outreach to help identify and reach men's health clinics with the highest conversion potential.

### Key Features

- **Keyword Scanner**: Track spiking keywords for men's health services (TRT, IV Therapy, ED, Sexual Health, Peptide, GLP-1, Hair Loss Restoration) across affluent markets
- **Clinic Discovery**: Find men's health clinics using Google Places API with automatic categorization
- **Lead Enrichment**: Identify decision makers (owners, medical directors, clinic managers) using Apollo.io and Clearbit
- **CRM Management**: Track clinic contacts with scoring based on market affluence and keyword trends
- **AI Voice Agent**: Automated outbound calling via Vapi or Bland AI with conversation intelligence

### Target Markets

Pre-configured affluent US markets including:
- Atherton, CA (San Francisco Bay Area)
- Beverly Hills, CA (Los Angeles)
- Scottsdale, AZ (Phoenix)
- Naples, FL
- Greenwich, CT (New York Metro)
- Palm Beach, FL
- Newport Beach, CA (Orange County)
- And more...

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
cd novalyte-abm

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start development server
npm run dev
```

### Environment Variables

Configure the following API keys in your `.env` file:

```env
# Google Trends / Keyword Intelligence
VITE_SERPAPI_KEY=your_serpapi_key

# Clinic Discovery
VITE_GOOGLE_PLACES_API_KEY=your_google_places_key

# Lead Enrichment
VITE_APOLLO_API_KEY=your_apollo_key
VITE_CLEARBIT_API_KEY=your_clearbit_key

# AI Voice Agent (choose one or both)
VITE_VAPI_API_KEY=your_vapi_key
VITE_BLAND_AI_API_KEY=your_bland_ai_key

# OpenAI (for conversation intelligence)
VITE_OPENAI_API_KEY=your_openai_key
```

## Architecture

```
src/
├── components/          # React UI components
│   ├── Dashboard.tsx    # Main dashboard with metrics
│   ├── KeywordScanner.tsx  # Keyword trend tracking
│   ├── ClinicDiscovery.tsx # Clinic search & discovery
│   ├── CRM.tsx          # Contact management
│   └── VoiceAgent.tsx   # AI calling interface
├── services/            # API integrations
│   ├── keywordService.ts    # Google Trends via SerpAPI
│   ├── clinicService.ts     # Google Places integration
│   ├── enrichmentService.ts # Apollo/Clearbit enrichment
│   └── voiceAgentService.ts # Vapi/Bland AI calling
├── stores/              # State management
│   └── appStore.ts      # Zustand global store
├── types/               # TypeScript definitions
│   └── index.ts         # All type definitions
└── utils/               # Utility functions
    └── cn.ts            # Tailwind class merging
```

## Usage

### 1. Scan Keywords

Navigate to the Keyword Scanner tab to:
- Select an affluent market
- Scan for trending men's health keywords
- Identify markets with spiking demand

### 2. Discover Clinics

In Clinic Discovery:
- Choose a market with high keyword trends
- Click "Discover Clinics" to find relevant practices
- Review clinic details and add promising ones to CRM

### 3. Manage Contacts

The CRM allows you to:
- View all clinic contacts with priority scores
- Update contact status through the sales pipeline
- Add notes and track keyword matches
- See decision maker information

### 4. Launch Voice Campaigns

Use the Voice Agent to:
- Review contacts ready to call
- Select AI provider (Vapi or Bland AI)
- Initiate calls individually or in batch
- Monitor call outcomes and sentiment

## Scripts

```bash
# Development
npm run dev          # Start dev server on port 3000

# Build
npm run build        # Build for production

# Code Quality
npm run lint         # Run ESLint
npm run typecheck    # Run TypeScript check

# CLI Tools
npm run scan:keywords    # Scan keywords (CLI)
npm run discover:clinics # Discover clinics (CLI)
npm run sync:crm         # Sync CRM data (CLI)
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS
- **State**: Zustand
- **Icons**: Lucide React
- **Charts**: Recharts
- **HTTP**: Axios

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

Proprietary - Novalyte AI
