# Novalyte AI Intelligent Engine

## The First Vertical AI Sales Intelligence Platform for Men's Health

---

## What Is Novalyte?

Novalyte is a full-stack AI-powered sales intelligence and patient acquisition platform purpose-built for the $65B men's health market. It is two products working as one system:

1. **intel.novalyte.io** — A patient-facing AI assessment funnel that qualifies men for TRT, GLP-1 weight loss, peptide therapy, sexual wellness, and longevity treatments. Patients complete a conversational quiz, receive an AI-generated compatibility score, and are matched with clinics. Every assessment syncs in real-time to the sales platform.

2. **novalyte-abm** — An account-based marketing (ABM) intelligence platform that discovers men's health clinics across the US, enriches them with decision-maker data, verifies emails, generates AI-personalized outreach, and deploys an AI voice agent to call clinics and close partnerships — all from a single dashboard.

The two products form a closed loop: patients flow in through the assessment funnel, clinics are discovered and sold through the ABM engine, and Novalyte sits in the middle as the infrastructure layer connecting supply (clinics) to demand (patients).

Nothing like this exists. There is no vertical AI sales platform for men's health. There is no system that combines clinic discovery, decision-maker enrichment, email verification, AI-written outreach, voice AI calling, keyword intelligence, revenue forecasting, and a patient acquisition funnel into a single product. Novalyte is the first.

---

## The Engine: Feature-by-Feature Breakdown

### 1. Clinic Discovery Engine

**What it does:** Discovers every men's health clinic in a target market using an exhaustive grid search strategy.

**How it works:**
- 44 men's-health-specific search queries (TRT clinics, testosterone therapy, ED treatment, GLP-1 weight loss, peptide therapy, men's med spa, hair restoration, etc.)
- Each query is executed across 9 geographic grid points per market (center + 8 surrounding points at 15-mile offsets)
- That's **44 queries × 9 grid points = 396 API calls per market**, each returning up to 20 results
- Raw results are deduplicated by Google Place ID, then filtered through a 50+ keyword exclusion engine that removes women's clinics, dental offices, veterinary practices, salons, pharmacies, and other false positives
- Typical yield: **50–200+ unique men's health clinics per metro area**

**Markets covered:** 12 pre-loaded affluent US markets (Atherton, Beverly Hills, Scottsdale, Naples, Greenwich, Aspen, Palm Beach, Malibu, Paradise Valley, The Woodlands, Coral Gables, Newport Beach) with custom market support.

**API:** Google Places API (New) — Text Search endpoint with field masks for rich data (ratings, reviews, phone, website, coordinates).

---

### 2. Multi-Source Decision Maker Enrichment

**What it does:** For every discovered clinic, the engine finds the real humans who make purchasing decisions — owners, medical directors, practice managers — along with their verified email addresses and direct phone numbers.

**Enrichment waterfall (executed in order until results are found):**

1. **Apollo.io** — Domain-based and org-name search with multi-key rotation. Searches for 15 decision-maker titles (Owner, Founder, CEO, Medical Director, Clinic Manager, Practice Administrator, Marketing Director, etc.). Returns email, phone, LinkedIn, seniority, and department data. When one API key hits its rate limit or credit cap, the system automatically rotates to the next key and retries — zero downtime, zero manual intervention.

2. **NPI Registry** — The public National Provider Identifier database maintained by CMS. Searches by organization name + city/state, extracts authorized officials (the legal decision-maker for the practice). Falls back to broader taxonomy-based searches (Internal Medicine, Urology, Family Medicine) when exact name matches fail.

3. **Clearbit** — Email-based enrichment pass. When NPI returns an email but limited profile data, Clearbit fills in name, title, LinkedIn URL, and company info.

4. **Exa + Gemini AI Pipeline** — When Apollo and NPI return nothing, the engine activates a web intelligence pipeline:
   - **Exa** searches for the clinic's staff pages, LinkedIn profiles, and about pages using 3 targeted queries
   - Extracts real names, titles, and email addresses from scraped content using regex pattern matching
   - **Gemini 2.0 Flash** analyzes the scraped content to identify additional people and infer roles
   - Generates personal email patterns from discovered names + clinic domain (first@domain, first.last@domain, flast@domain, dr.last@domain, etc.)
   - All generated emails are verified before being returned

5. **RevenueBase Email Verification** — Every email address discovered through any source is verified via RevenueBase's API before entering the CRM. Results are classified as `valid`, `invalid`, or `risky`. Confidence scores are adjusted: valid emails get +20 confidence, invalid emails get -30, risky emails get +5 (capped at 80). Decision makers are re-sorted so verified-valid contacts appear first.

6. **Phone Fallback** — If no decision maker is found through any source, the engine creates a "Front Desk" contact entry using the clinic's phone number so the CRM is never empty and the voice agent can still call.

**Result:** Every clinic in the CRM has at least one actionable contact — a verified email, a direct phone number, or both.

---

### 3. AI Email Personalization Engine (Gemini)

**What it does:** Writes unique, human-quality cold outreach emails for every clinic using real data about the clinic, its market, and its decision maker.

**How it works:**
- Gemini 2.0 Flash generates each email using a detailed prompt that includes: clinic name, services, location, Google rating, review count, market affluence score, median income, decision maker name/title/role, trending keywords in their area, and the clinic's website
- Three sequence steps: **Intro** (data-driven first touch, <150 words), **Follow-up** (new value add, shorter), **Breakup** (graceful close, <80 words)
- Each email includes a subject line (<60 chars, no emojis), HTML body, plain text body, and personalization notes explaining why Gemini chose that angle
- Previous email subjects are passed in to prevent repetition across the sequence

**Signed as:** "Jamil" from Novalyte — real human name, not a bot.

---

### 4. Smart 3-Step Sequencing Engine

**What it does:** Automates a timed email sequence for every contact in the pipeline.

**Sequence logic:**
- **Day 1:** Intro email (AI-generated)
- **Day 3:** Follow-up email (if no open detected)
- **Day 7:** Breakup email (final touch)

**State machine:** Each contact's sequence state is computed from sent email history. The engine tracks: `intro`, `follow_up`, `breakup`, `completed`, `replied`, `opted_out`. Contacts that open or click any email are flagged as `replied` (engaged — manual follow-up). Bounced emails trigger `opted_out`. The sequence queue function returns all contacts ready for their next email, respecting delay windows.

---

### 5. Email Outreach Verification & Confidence Scoring

**What it does:** Before any email is sent, the outreach tab runs a full verification and confidence assessment.

**Features:**
- "Verify Emails" button runs RevenueBase verification on all selected contacts in batches of 3
- Each clinic shows an email confidence score (0–100%) with shield icons (green = verified, amber = risky, red = invalid)
- Confidence is computed from: RevenueBase verification status → DM enrichment verification → enrichedContacts verification → source heuristics
- "Remove Invalid" button strips invalid emails from the selection and draft queue
- Pre-send "Send Queue Health" bar shows average confidence across all drafts
- Invalid/risky email warnings with inline remove actions appear before the Send button

---

### 6. Kaizen — AI Voice Agent (Vapi)

**What it does:** An AI-powered voice agent named Kaizen calls clinics on behalf of Novalyte to pitch the partnership and capture email addresses.

**Production-grade features:**
- **HIPAA-enabled** calls with structured analysis plans
- **Business hours enforcement** — calls only go out Mon–Fri 9AM–5PM Eastern, with timezone-aware checking
- **Do Not Call (DNC) registry** — in-memory DNC list, auto-adds numbers when prospects say "don't call again" or "remove me"
- **Batch calling** with rate limiting (8s spacing between calls, max 5 concurrent), 24-hour cooldown per contact
- **Retry with exponential backoff** — 3 retries on server errors, respects 429 rate limit headers
- **Concurrency guard** — prevents exceeding Vapi's concurrent call limit

**Conversation design:**
- Dynamic first message personalized with clinic name, city, top service, and decision maker name
- Full system prompt with: clinic data, market affluence, pitch framework, objection handling scripts, gatekeeper strategy, and email capture protocol
- **Email capture is the #1 goal** — Kaizen spells back captured emails letter-by-letter for confirmation
- Graceful handling of "not interested", "too busy", "send me an email", and "don't call again"

**Post-call analysis:**
- Vapi's AI generates: call summary, success evaluation (numeric scale), and structured data extraction
- Structured data includes: `reached_decision_maker`, `interest_level` (high/medium/low/none), `next_step` (demo_scheduled/send_info/callback/dnc), `callback_time`, `objections`, `gatekeeper_name`, `email_captured`, `competitor_mentioned`
- Fallback keyword-based transcript analysis when Vapi structured data is unavailable

---

### 7. Competitor Intelligence (Gemini)

**What it does:** Analyzes whether a clinic already works with a marketing agency and recommends the best outreach approach.

**How it works:** Gemini evaluates the clinic's website quality signals, review count, market size, and service mix to determine: whether they have an agency, what type (SEO, PPC, full-service, social), confidence level, supporting signals, and a tailored outreach recommendation.

---

### 8. Revenue Forecasting Engine

**What it does:** Projects Novalyte's revenue based on the current pipeline, using real men's health lead economics.

**Lead economics table (built from real market data):**

| Service | CPL Range | Patient LTV | Close Rate |
|---------|-----------|-------------|------------|
| TRT / Hormone Therapy | $150–350 | $6,000+ | 25–40% |
| ED / Sexual Health | $200–500 | $4,000+ | 20–35% |
| Peptide Therapy | $100–250 | $8,000+ | 30–45% |
| GLP-1 / Weight Loss | $75–200 | $5,000+ | 35–50% |
| Hair Restoration | $250–600 | $12,000+ | 15–25% |
| IV Therapy | $50–150 | $2,400+ | 40–55% |
| Anti-Aging / Aesthetics | $100–300 | $3,500+ | 25–40% |
| PRP Therapy | $150–400 | $5,000+ | 20–30% |

**Calculations:**
- Each clinic's services are matched to the economics table
- Affluence multiplier adjusts lead prices (1.0x–1.4x based on market affluence score)
- Conversion funnel: contact → emailed → opened → qualified → client (22% of qualified leads become clients)
- Each clinic client receives ~20 qualified patient leads/month
- Revenue = projected clients × leads/month × avg lead price
- Per-service breakdown, per-market breakdown, pipeline value, and clinic ROI (typically 5–10x)
- Confidence score (25–95%) based on pipeline maturity signals

---

### 9. AI Insights Engine (Gemini + Heuristics)

**What it does:** Generates real-time strategic intelligence from pipeline data.

**Insight types:**
- **Risk alerts:** Overdue follow-ups, stale contacts, email coverage gaps
- **Opportunities:** High-growth keywords, untapped premium markets, high-rated clinics not in CRM
- **Actions:** Contacts needing enrichment, call backlogs, qualified leads ready for conversion
- **Forecasts:** Gemini-generated strategic insights based on pipeline summary data (status breakdown, top markets, hot keywords, average scores)

**Pipeline health scoring:** 0–100 composite score factoring conversion rate, email coverage, stale contact rate, overdue follow-ups, and lead quality. Trend detection (improving/stable/declining) based on 7-day activity volume. Bottleneck identification with specific recommendations.

**Market opportunity scoring:** Per-market scores based on affluence, keyword trends, CRM penetration, and growth signals.

---

### 10. Multi-Touch Attribution

**What it does:** Tracks every touchpoint in a contact's journey from keyword discovery to qualification.

**Touchpoint types:** keyword_discovered → clinic_discovered → enriched → email_sent → email_opened → called → qualified

**Output:** Full chronological journey, days in pipeline, conversion path string (e.g., "keyword → discovery → email → call → qualified"), first/last touch detail.

---

### 11. Patient Acquisition Funnel (intel.novalyte.io)

**What it does:** Converts anonymous web visitors into qualified patient leads that flow directly into the ABM platform.

**Features:**
- **Conversational AI quiz** — not a boring form. Patients answer questions about symptoms (low energy, weight gain, low libido, brain fog), goals, timeline, and contact info in a chat-like interface
- **AI-powered analysis** — Gemini generates a compatibility score, personalized recommendation, biomarker suggestions, clinic match, and educational content
- **Hero rotation** — Landing page cycles through 5 treatment verticals (TRT, GLP-1, Peptides, Longevity, Sexual Wellness) every 6 seconds for SEO and engagement
- **Real-time social proof** — Live lead count from Supabase, rotating proof messages ("A patient in Scottsdale was matched 4 minutes ago")
- **Particle field animation** — WebGL-style ambient background
- **PDF report download** — Patients can download their full analysis as a branded PDF
- **Email delivery** — Confirmation email + full results email via Resend
- **Slack alerts** — Every new lead triggers a Slack notification to the sales team
- **Supabase sync** — Every assessment is saved to the `leads` table in real-time, accessible from the ABM platform's Patient Leads tab

---

### 12. Real-Time Data Infrastructure

**Supabase (PostgreSQL):**
- `clinics` table with `enriched_contacts` JSONB column
- `decision_makers` table with `email_verified` and `email_verification_status` fields
- `leads` table synced from intel-landing assessments
- Real-time sync from the ABM dashboard (bulk save, individual save, enrichment updates)

**Sync resilience:** If a column doesn't exist (e.g., `enriched_contacts` before migration), the sync retries without that field — never fails silently, never blocks the user.

---

## API Integrations

| API | Purpose |
|-----|---------|
| Google Places (New) | Clinic discovery — grid search across markets |
| Apollo.io | Decision maker enrichment — multi-key rotation |
| NPI Registry (CMS) | Healthcare provider lookup — authorized officials |
| Clearbit | Email-based contact enrichment |
| Exa | Web intelligence — staff pages, LinkedIn, about pages |
| Google Gemini 2.0 Flash | AI email writing, people extraction, competitor intel, insights, patient analysis |
| Google Vertex AI | GCP-native Gemini endpoint (fallback routing) |
| RevenueBase | Email verification — valid/invalid/risky classification |
| Vapi | AI voice agent — outbound calling with HIPAA, structured analysis |
| Resend | Transactional email delivery — outreach, confirmations, results |
| SerpAPI | Keyword trend scanning — search volume, growth rates |
| Supabase | Real-time PostgreSQL — leads, clinics, decision makers |
| Slack Webhooks | Lead alerts — instant notification on new assessments |

---

## The Two-Product Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PATIENT SIDE                          │
│                                                         │
│  intel.novalyte.io (ads.novalyte.io)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Landing     │→ │ Conversational│→ │  Results +   │  │
│  │  (5 verticals│  │ AI Quiz      │  │  AI Analysis │  │
│  │   rotating)  │  │              │  │  + PDF + Email│  │
│  └─────────────┘  └──────────────┘  └──────┬───────┘  │
│                                             │          │
│                    Supabase leads table ←────┘          │
│                         │                              │
└─────────────────────────┼──────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    SALES SIDE                            │
│                                                         │
│  novalyte-abm (intel.novalyte.io dashboard)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Clinic   │ │ CRM +    │ │ Email    │ │ Voice    │  │
│  │ Discovery│ │ Enrichment│ │ Outreach │ │ Agent    │  │
│  │ (44×9    │ │ (Apollo, │ │ (Gemini  │ │ (Kaizen) │  │
│  │  grid)   │ │  NPI,Exa)│ │  + Resend│ │ via Vapi │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Keyword  │ │ Revenue  │ │ AI       │ │ Patient  │  │
│  │ Scanner  │ │ Forecast │ │ Insights │ │ Leads    │  │
│  │ (SerpAPI)│ │ (LTV/CPL)│ │ (Gemini) │ │ (Supabase│  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Why Nothing Like This Exists

**1. Vertical AI, not horizontal SaaS.** Every feature is built for men's health. The 44 discovery queries are men's-health-specific. The exclusion filter removes women's clinics and irrelevant businesses. The lead economics table has real CPL/LTV/close-rate data for TRT, GLP-1, peptides, ED, hair restoration, and IV therapy. The voice agent's script references men's health services by name. This is not a generic CRM with a healthcare skin — it is a purpose-built intelligence engine for a specific vertical.

**2. Closed-loop patient-to-clinic pipeline.** No other platform connects patient acquisition (assessment funnel) to clinic sales (ABM engine) in a single system. Patients who complete an assessment on ads.novalyte.io become leads that Novalyte sells to clinics discovered and enriched by the ABM engine. The product creates both supply and demand.

**3. AI at every layer.** Gemini writes the outreach emails. Gemini extracts decision makers from web content. Gemini analyzes competitors. Gemini generates strategic insights. Gemini powers the patient assessment. Vapi's AI voice agent calls clinics and captures emails. This is not a tool with an AI feature — AI is the core of every workflow.

**4. Multi-source enrichment with verification.** Apollo → NPI → Clearbit → Exa → Gemini → RevenueBase. Six data sources in a waterfall, with automatic key rotation, fallback logic, and email verification on every result. No other sales tool chains this many sources with this level of resilience.

**5. Voice AI with structured intelligence.** Kaizen doesn't just make calls — it extracts structured data from every conversation (interest level, next steps, objections, competitor mentions, captured emails) and feeds it back into the CRM. The voice agent is not a dialer; it is an intelligence-gathering system.

**6. Revenue forecasting grounded in real economics.** The forecasting engine uses actual men's health lead pricing data, not generic SaaS metrics. It knows that a TRT lead in Paradise Valley (affluence 9/10) commands $350+ while an IV therapy lead in a mid-tier market is $75. It calculates clinic ROI so the sales pitch is backed by real numbers.

---

## Market Opportunity

- **Men's health market:** $65B and growing 8% annually
- **TRT market alone:** $1.6B, projected to reach $3.2B by 2030
- **GLP-1 weight loss:** $50B+ market with explosive demand
- **Total addressable clinics:** 15,000+ men's health, hormone, and wellness clinics in the US
- **No dominant vertical platform:** Clinics use generic CRMs (HubSpot, Salesforce) and generic marketing agencies. No one owns the men's health clinic sales intelligence category.

---

## Why YC Should Accept Novalyte

1. **The product is built.** This is not a pitch deck. The engine is live, deployed on Google Cloud Run, processing real data. Clinics are being discovered, enriched, and contacted today.

2. **The moat is deep.** The combination of vertical-specific discovery queries, multi-source enrichment waterfall, AI voice agent, and closed-loop patient pipeline creates compounding defensibility. Each new clinic in the CRM makes the patient matching better. Each new patient assessment makes the clinic pitch stronger.

3. **The unit economics work.** At $200 average CPL and 20 leads/month per clinic client, each clinic is worth $4,000/month to Novalyte. With a 22% close rate on qualified leads, a pipeline of 100 qualified clinics projects to $88,000/month recurring revenue.

4. **The founder built the entire stack.** One person built: the discovery engine, the enrichment waterfall, the AI email writer, the voice agent, the sequencing engine, the revenue forecaster, the patient funnel, the real-time sync layer, and deployed it all to production. That is the kind of technical velocity YC looks for.

5. **The timing is perfect.** Men's health is destigmatizing rapidly. GLP-1 demand is creating a gold rush of new clinics. AI voice agents just became production-ready. The infrastructure to build this product only became possible in the last 12 months. Novalyte is first to market with a complete vertical AI sales platform.

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| AI Models | Google Gemini 2.0 Flash (via Vertex AI + Gemini API) |
| Voice AI | Vapi (GPT-4o-mini for conversation, HIPAA-enabled) |
| Database | Supabase (PostgreSQL + real-time subscriptions) |
| Email | Resend (transactional + outreach) |
| Hosting | Google Cloud Run (containerized, auto-scaling) |
| CI/CD | Google Cloud Build |
| Search Intel | SerpAPI (keyword trends + SERP analysis) |
| Web Intel | Exa (semantic web search + content extraction) |
| Enrichment | Apollo.io, NPI Registry, Clearbit, RevenueBase |

---

## Live URLs

- **Patient funnel:** https://ads.novalyte.io
- **ABM dashboard:** https://intel.novalyte.io
- **GitHub:** https://github.com/novalyte-logic

---

*Built by Jamil Yakasai. One founder. One vision. The entire engine.*
