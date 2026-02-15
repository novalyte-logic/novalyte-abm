/**
 * Supabase Sync Service
 * Bidirectional sync between Zustand store and Supabase.
 * Supabase is source of truth once connected.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  MarketZone, Clinic, CRMContact, KeywordTrend, DecisionMaker,
  Activity, VoiceCall, Campaign,
} from '../types';

// ─── Helpers ───
const iso = (d: Date | string | undefined | null) =>
  d instanceof Date ? d.toISOString() : d ? String(d) : null;

// ─── Market mappers ───
function marketToRow(m: MarketZone) {
  return {
    id: m.id, city: m.city, state: m.state,
    metropolitan_area: m.metropolitanArea,
    median_income: m.medianIncome, population: m.population,
    affluence_score: m.affluenceScore,
    lat: m.coordinates.lat, lng: m.coordinates.lng,
  };
}
function rowToMarket(r: any): MarketZone {
  return {
    id: r.id, city: r.city, state: r.state,
    metropolitanArea: r.metropolitan_area,
    medianIncome: Number(r.median_income), population: r.population,
    affluenceScore: Number(r.affluence_score),
    coordinates: { lat: Number(r.lat), lng: Number(r.lng) },
  };
}

// ─── Clinic mappers ───
function clinicToRow(c: Clinic) {
  return {
    id: c.id, name: c.name, type: c.type,
    street: c.address.street, city: c.address.city,
    state: c.address.state, zip: c.address.zip, country: c.address.country,
    phone: c.phone || null, email: c.email || null, website: c.website || null,
    google_place_id: c.googlePlaceId || null, yelp_id: c.yelpId || null,
    rating: c.rating ?? null, review_count: c.reviewCount ?? null,
    manager_name: c.managerName || null, manager_email: c.managerEmail || null,
    owner_name: c.ownerName || null, owner_email: c.ownerEmail || null,
    verification_status: c.verificationStatus || 'Ready',
    services: c.services || [],
    market_id: c.marketZone.id,
    discovered_at: iso(c.discoveredAt), last_updated: iso(c.lastUpdated),
  };
}

function isMissingVerificationStatusError(message?: string | null): boolean {
  const text = (message || '').toLowerCase();
  return text.includes('verification_status') && text.includes('schema cache');
}

function rowToClinic(r: any, market: MarketZone): Clinic {
  return {
    id: r.id, name: r.name, type: r.type,
    address: { street: r.street || '', city: r.city || '', state: r.state || '', zip: r.zip || '', country: r.country || 'USA' },
    phone: r.phone || '', email: r.email || undefined, website: r.website || undefined,
    googlePlaceId: r.google_place_id || undefined, yelpId: r.yelp_id || undefined,
    rating: r.rating != null ? Number(r.rating) : undefined,
    reviewCount: r.review_count ?? undefined,
    managerName: r.manager_name || undefined, managerEmail: r.manager_email || undefined,
    ownerName: r.owner_name || undefined, ownerEmail: r.owner_email || undefined,
    enrichedContacts: r.enriched_contacts || undefined,
    verificationStatus: r.verification_status || 'Ready',
    services: r.services || [],
    marketZone: market,
    discoveredAt: new Date(r.discovered_at), lastUpdated: new Date(r.last_updated),
  };
}

// ─── Decision Maker mappers ───
function dmToRow(dm: DecisionMaker) {
  return {
    id: dm.id, clinic_id: dm.clinicId,
    first_name: dm.firstName, last_name: dm.lastName,
    title: dm.title || null, role: dm.role || null,
    email: dm.email || null, phone: dm.phone || null,
    linkedin_url: dm.linkedInUrl || null,
    confidence: dm.confidence, enriched_at: iso(dm.enrichedAt),
    source: dm.source || null,
    email_verified: dm.emailVerified || false,
    email_verification_status: dm.emailVerificationStatus || null,
  };
}
function rowToDm(r: any): DecisionMaker {
  return {
    id: r.id, clinicId: r.clinic_id,
    firstName: r.first_name, lastName: r.last_name,
    title: r.title || '', role: r.role || 'clinic_manager',
    email: r.email || undefined, phone: r.phone || undefined,
    linkedInUrl: r.linkedin_url || undefined,
    confidence: Number(r.confidence || 0),
    enrichedAt: r.enriched_at ? new Date(r.enriched_at) : undefined,
    source: r.source || 'manual',
    emailVerified: r.email_verified || false,
    emailVerificationStatus: r.email_verification_status || undefined,
  };
}

function normalizeDecisionMakerRole(roleOrTitle?: string): DecisionMaker['role'] {
  const raw = String(roleOrTitle || '').toLowerCase();
  if (raw.includes('owner') || raw.includes('founder') || raw.includes('ceo')) return 'owner';
  if (raw.includes('medical director') || raw.includes('physician') || raw.includes('doctor')) return 'medical_director';
  if (raw.includes('administrator') || raw.includes('practice admin')) return 'practice_administrator';
  if (raw.includes('marketing')) return 'marketing_director';
  if (raw.includes('operations') || raw.includes('ops')) return 'operations_manager';
  return 'clinic_manager';
}

function splitName(fullName?: string): { firstName: string; lastName: string } {
  const clean = String(fullName || '').trim();
  if (!clean) return { firstName: 'Unknown', lastName: 'Contact' };
  const [firstName, ...rest] = clean.split(/\s+/);
  return { firstName: firstName || 'Unknown', lastName: rest.join(' ') || 'Contact' };
}

function slugToken(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function isGenericEmail(email?: string): boolean {
  const local = String(email || '').split('@')[0]?.toLowerCase() || '';
  const genericPrefixes = new Set([
    'info', 'contact', 'office', 'admin', 'frontdesk', 'hello', 'support', 'help',
    'reception', 'appointments', 'billing', 'marketing', 'sales', 'hr', 'noreply', 'no-reply', 'webmaster', 'mail',
  ]);
  return genericPrefixes.has(local);
}

// ─── KeywordTrend mappers ───
function trendToRow(t: KeywordTrend) {
  return {
    id: t.id, keyword: t.keyword, market_id: t.location.id,
    trend_score: t.trendScore, search_volume: t.searchVolume,
    growth_rate: t.growthRate, competitor_activity: t.competitorActivity,
    timestamp: iso(t.timestamp),
  };
}
function rowToTrend(r: any, market: MarketZone): KeywordTrend {
  return {
    id: r.id, keyword: r.keyword, location: market,
    trendScore: Number(r.trend_score), searchVolume: r.search_volume,
    growthRate: Number(r.growth_rate), competitorActivity: r.competitor_activity || 'low',
    timestamp: new Date(r.timestamp),
  };
}

// ─── Activity mappers ───
function activityToRow(a: Activity, contactId: string) {
  return {
    id: a.id, contact_id: contactId, type: a.type,
    description: a.description, metadata: a.metadata || {},
    timestamp: iso(a.timestamp),
  };
}
function rowToActivity(r: any): Activity {
  return {
    id: r.id, type: r.type, description: r.description,
    metadata: r.metadata || {}, timestamp: new Date(r.timestamp),
  };
}

// ─── VoiceCall mappers ───
function callToRow(c: VoiceCall) {
  return {
    id: c.id, contact_id: c.contactId, agent_id: c.agentId,
    start_time: iso(c.startTime), end_time: iso(c.endTime),
    duration: c.duration ?? null, status: c.status,
    outcome: c.outcome || null, transcript: c.transcript || null,
    recording_url: c.recording_url || null, sentiment: c.sentiment || null,
    notes: c.notes || null, follow_up_required: c.followUpRequired,
    follow_up_date: iso(c.followUpDate),
  };
}
function rowToCall(r: any): VoiceCall {
  return {
    id: r.id, contactId: r.contact_id, agentId: r.agent_id,
    startTime: new Date(r.start_time),
    endTime: r.end_time ? new Date(r.end_time) : undefined,
    duration: r.duration ?? undefined, status: r.status,
    outcome: r.outcome || undefined, transcript: r.transcript || undefined,
    recording_url: r.recording_url || undefined,
    sentiment: r.sentiment || undefined, notes: r.notes || undefined,
    followUpRequired: r.follow_up_required || false,
    followUpDate: r.follow_up_date ? new Date(r.follow_up_date) : undefined,
  };
}

// ─── Campaign mappers ───
function campaignToRow(c: Campaign) {
  return {
    id: c.id, name: c.name, description: c.description,
    status: c.status, script: c.script,
    start_date: iso(c.startDate), end_date: iso(c.endDate),
    stats: c.stats || {},
    created_at: iso(c.createdAt), updated_at: iso(c.updatedAt),
  };
}
function rowToCampaign(r: any): Campaign {
  return {
    id: r.id, name: r.name, description: r.description || '',
    status: r.status, script: r.script || '',
    startDate: r.start_date ? new Date(r.start_date) : undefined,
    endDate: r.end_date ? new Date(r.end_date) : undefined,
    stats: r.stats || { totalContacts: 0, called: 0, connected: 0, qualified: 0, notInterested: 0 },
    targetMarkets: [], targetKeywords: [], contacts: [],
    createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
  };
}


/* ═══════════════════════════════════════════════════
   SYNC SERVICE — all public methods are no-ops
   when Supabase is not configured
   ═══════════════════════════════════════════════════ */

class SupabaseSyncService {
  private ready = false;
  private readonly PAGE_SIZE = 1000;

  private async fetchAllRows(table: string, select = '*'): Promise<any[]> {
    if (!supabase) return [];
    const rows: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .range(from, from + this.PAGE_SIZE - 1);
      if (error) throw new Error(`${table} fetch: ${error.message}`);
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < this.PAGE_SIZE) break;
      from += this.PAGE_SIZE;
    }
    return rows;
  }

  /** Test connection and verify tables exist */
  async init(): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return false;
    try {
      const { error } = await supabase.from('markets').select('id').limit(1);
      if (error) {
        console.warn('Supabase tables not found — run migration first.', error.message);
        return false;
      }
      this.ready = true;
      console.log('✓ Supabase sync connected');
      return true;
    } catch (e) {
      console.warn('Supabase connection failed:', e);
      return false;
    }
  }

  get isReady() { return this.ready; }

  // ─── Markets ───
  async syncMarkets(markets: MarketZone[]): Promise<void> {
    if (!this.ready || !supabase) return;
    const rows = markets.map(marketToRow);
    const { error } = await supabase.from('markets').upsert(rows, { onConflict: 'id' });
    if (error) console.error('syncMarkets error:', error.message);
  }

  async fetchMarkets(): Promise<MarketZone[] | null> {
    if (!this.ready || !supabase) return null;
    try {
      const data = await this.fetchAllRows('markets');
      if (!data.length) return null;
      return data.map(rowToMarket);
    } catch {
      return null;
    }
  }

  // ─── Clinics ───
  async syncClinics(clinics: Clinic[]): Promise<void> {
    if (!this.ready || !supabase || !clinics.length) return;
    // Ensure markets exist first
    const markets = clinics.reduce<Record<string, MarketZone>>((acc, c) => {
      acc[c.marketZone.id] = c.marketZone; return acc;
    }, {});
    await this.syncMarkets(Object.values(markets));

    const rows = clinics.map(clinicToRow);
    // Batch upsert in chunks of 100
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await supabase.from('clinics').upsert(chunk, { onConflict: 'id' });
      if (!error) continue;
      if (!isMissingVerificationStatusError(error.message)) {
        console.error('syncClinics error:', error.message);
        continue;
      }

      const legacyChunk = chunk.map(c => {
        const legacy = { ...c } as Record<string, unknown>;
        delete legacy.verification_status;
        return legacy;
      });
      const { error: legacyError } = await supabase.from('clinics').upsert(legacyChunk, { onConflict: 'id' });
      if (legacyError) console.error('syncClinics fallback error:', legacyError.message);
    }

    // Backfill decision_makers from clinic-level enrichment cache before downstream scoring sync.
    const dmRows: any[] = [];
    const seenDmIds = new Set<string>();

    for (const clinic of clinics) {
      const pushDmRow = (row: any) => {
        if (!row?.id || seenDmIds.has(row.id)) return;
        seenDmIds.add(row.id);
        dmRows.push(row);
      };

      for (const ec of clinic.enrichedContacts || []) {
        const email = ec.email || null;
        const phone = ec.phone || null;
        if (!email && !phone) continue;
        const token = slugToken(email || phone || ec.name) || `ec-${dmRows.length}`;
        const dmId = `dm-${clinic.id}-${token}`;
        const { firstName, lastName } = splitName(ec.name);
        const rawStatus = String(ec.emailVerificationStatus || 'unknown').toLowerCase();
        const status = (rawStatus === 'valid' || rawStatus === 'invalid' || rawStatus === 'risky' || rawStatus === 'unknown')
          ? rawStatus
          : 'unknown';
        // `email_verified` means deliverable/valid (safe to outreach).
        // If status is missing but emailVerified is true, treat as valid (back-compat for older persisted shapes).
        const verified = status === 'valid' || (Boolean(ec.emailVerified) && status === 'unknown');

        pushDmRow({
          id: dmId,
          clinic_id: clinic.id,
          first_name: firstName,
          last_name: lastName,
          title: ec.title || '',
          role: normalizeDecisionMakerRole(ec.role || ec.title),
          email,
          phone,
          linkedin_url: ec.linkedInUrl || null,
          confidence: Number(ec.confidence || 0),
          enriched_at: ec.enrichedAt || new Date().toISOString(),
          source: ec.source || 'manual',
          email_verified: Boolean(verified),
          email_verification_status: status,
        });
      }

      const managerCandidateEmail = clinic.managerEmail || clinic.ownerEmail || clinic.email || null;
      if (managerCandidateEmail || clinic.managerName || clinic.ownerName || clinic.phone) {
        const managerName = clinic.managerName || clinic.ownerName || 'Clinic Contact';
        const token = slugToken(managerCandidateEmail || clinic.phone || managerName) || 'manager';
        const dmId = `dm-${clinic.id}-${token}`;
        const { firstName, lastName } = splitName(managerName);
        const inferredStatus = managerCandidateEmail && isGenericEmail(managerCandidateEmail) ? 'unknown' : 'unknown';
        pushDmRow({
          id: dmId,
          clinic_id: clinic.id,
          first_name: firstName,
          last_name: lastName,
          title: clinic.ownerName ? 'Owner' : 'Clinic Manager',
          role: clinic.ownerName ? 'owner' : 'clinic_manager',
          email: managerCandidateEmail,
          phone: clinic.phone || null,
          linkedin_url: null,
          confidence: managerCandidateEmail ? 55 : 35,
          enriched_at: new Date().toISOString(),
          source: 'manual',
          email_verified: false,
          email_verification_status: inferredStatus,
        });
      }
    }

    for (let i = 0; i < dmRows.length; i += 200) {
      const chunk = dmRows.slice(i, i + 200);
      const { error } = await supabase.from('decision_makers').upsert(chunk, { onConflict: 'id' });
      if (!error) continue;
      const legacyChunk = chunk.map(dm => {
        const legacy = { ...dm };
        delete legacy.email_verification_status;
        return legacy;
      });
      const { error: legacyError } = await supabase.from('decision_makers').upsert(legacyChunk, { onConflict: 'id' });
      if (legacyError) console.error('syncClinics decision_makers backfill error:', legacyError.message);
    }
  }

  async fetchClinics(marketMap: Record<string, MarketZone>): Promise<Clinic[] | null> {
    if (!this.ready || !supabase) return null;
    try {
      const data = await this.fetchAllRows('clinics');
      if (!data.length) return null;
      return data.map(r => {
        const market = marketMap[r.market_id];
        if (!market) return null;
        return rowToClinic(r, market);
      }).filter(Boolean) as Clinic[];
    } catch {
      return null;
    }
  }

  // ─── Keyword Trends ───
  async syncKeywordTrends(trends: KeywordTrend[]): Promise<void> {
    if (!this.ready || !supabase || !trends.length) return;
    const rows = trends.map(trendToRow);
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await supabase.from('keyword_trends').upsert(chunk, { onConflict: 'id' });
      if (error) console.error('syncKeywordTrends error:', error.message);
    }
  }

  async fetchKeywordTrends(marketMap: Record<string, MarketZone>): Promise<KeywordTrend[] | null> {
    if (!this.ready || !supabase) return null;
    try {
      const data = await this.fetchAllRows('keyword_trends');
      if (!data.length) return null;
      return data.map(r => {
        const market = marketMap[r.market_id];
        if (!market) return null;
        return rowToTrend(r, market);
      }).filter(Boolean) as KeywordTrend[];
    } catch {
      return null;
    }
  }

  // ─── Decision Makers ───
  async upsertDecisionMaker(dm: DecisionMaker): Promise<void> {
    if (!this.ready || !supabase) return;
    const { error } = await supabase.from('decision_makers').upsert(dmToRow(dm), { onConflict: 'id' });
    if (error) console.error('upsertDM error:', error.message);
  }

  async fetchDecisionMakers(): Promise<Record<string, DecisionMaker> | null> {
    if (!this.ready || !supabase) return null;
    let data: any[] = [];
    try {
      data = await this.fetchAllRows('decision_makers');
    } catch {
      return null;
    }
    if (!data.length) return null;
    const map: Record<string, DecisionMaker> = {};
    for (const r of data) map[r.id] = rowToDm(r);
    return map;
  }

  // ─── Contacts (CRM) ───
  async syncContacts(
    contacts: CRMContact[],
  ): Promise<void> {
    if (!this.ready || !supabase || !contacts.length) return;

    // Ensure clinics + DMs exist
    const clinics = contacts.map(c => c.clinic).filter(Boolean);
    await this.syncClinics(clinics);

    for (const c of contacts) {
      if (c.decisionMaker) await this.upsertDecisionMaker(c.decisionMaker);
    }

    // Upsert contacts
    const rows = contacts.map(c => ({
      id: c.id, clinic_id: c.clinic.id,
      decision_maker_id: c.decisionMaker?.id || null,
      status: c.status, priority: c.priority, score: c.score,
      tags: c.tags || [], notes: c.notes || '',
      created_at: iso(c.createdAt), updated_at: iso(c.updatedAt),
      last_contacted_at: iso(c.lastContactedAt),
      next_follow_up: iso(c.nextFollowUp),
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await supabase.from('contacts').upsert(chunk, { onConflict: 'id' });
      if (error) console.error('syncContacts error:', error.message);
    }

    // Sync keyword matches junction
    for (const c of contacts) {
      if (!c.keywordMatches?.length) continue;
      // Ensure trends exist
      await this.syncKeywordTrends(c.keywordMatches);
      const junctionRows = c.keywordMatches.map(km => ({
        contact_id: c.id, keyword_trend_id: km.id,
      }));
      // Delete old matches then insert new
      await supabase.from('contact_keyword_matches').delete().eq('contact_id', c.id);
      const { error } = await supabase.from('contact_keyword_matches').insert(junctionRows);
      if (error) console.error('syncContactKeywords error:', error.message);
    }

    // Sync activities
    for (const c of contacts) {
      if (!c.activities?.length) continue;
      const actRows = c.activities.map(a => activityToRow(a, c.id));
      const { error } = await supabase.from('activities').upsert(actRows, { onConflict: 'id' });
      if (error) console.error('syncActivities error:', error.message);
    }
  }

  async fetchContacts(
    marketMap: Record<string, MarketZone>,
  ): Promise<CRMContact[] | null> {
    if (!this.ready || !supabase) return null;

    // Fetch all needed data in parallel
    const [contactRows, clinicRowsRaw, dmRowsRaw, activityRowsRaw, trendRowsRaw, junctionRowsRaw] = await Promise.all([
      this.fetchAllRows('contacts'),
      this.fetchAllRows('clinics'),
      this.fetchAllRows('decision_makers'),
      this.fetchAllRows('activities'),
      this.fetchAllRows('keyword_trends'),
      this.fetchAllRows('contact_keyword_matches'),
    ]);

    if (!contactRows.length) return null;

    // Build lookup maps
    const clinicRows = new Map((clinicRowsRaw || []).map(r => [r.id, r]));
    const dmRows = new Map((dmRowsRaw || []).map(r => [r.id, r]));
    const activityMap = new Map<string, any[]>();
    for (const a of (activityRowsRaw || []).sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))) {
      if (!activityMap.has(a.contact_id)) activityMap.set(a.contact_id, []);
      activityMap.get(a.contact_id)!.push(a);
    }
    const trendRows = new Map((trendRowsRaw || []).map(r => [r.id, r]));
    const junctionMap = new Map<string, string[]>();
    for (const j of (junctionRowsRaw || [])) {
      if (!junctionMap.has(j.contact_id)) junctionMap.set(j.contact_id, []);
      junctionMap.get(j.contact_id)!.push(j.keyword_trend_id);
    }

    const contacts: CRMContact[] = [];
    for (const cr of contactRows) {
      const clinicRow = clinicRows.get(cr.clinic_id);
      if (!clinicRow) continue;
      const market = marketMap[clinicRow.market_id];
      if (!market) continue;

      const clinic = rowToClinic(clinicRow, market);
      const dm = cr.decision_maker_id && dmRows.has(cr.decision_maker_id)
        ? rowToDm(dmRows.get(cr.decision_maker_id))
        : undefined;
      const activities = (activityMap.get(cr.id) || []).map(rowToActivity);
      const trendIds = junctionMap.get(cr.id) || [];
      const keywordMatches = trendIds
        .map(tid => {
          const tr = trendRows.get(tid);
          return tr ? rowToTrend(tr, market) : null;
        })
        .filter(Boolean) as KeywordTrend[];

      contacts.push({
        id: cr.id, clinic, decisionMaker: dm,
        status: cr.status, priority: cr.priority, score: cr.score,
        tags: cr.tags || [], notes: cr.notes || '',
        keywordMatches, activities,
        createdAt: new Date(cr.created_at), updatedAt: new Date(cr.updated_at),
        lastContactedAt: cr.last_contacted_at ? new Date(cr.last_contacted_at) : undefined,
        nextFollowUp: cr.next_follow_up ? new Date(cr.next_follow_up) : undefined,
      });
    }
    return contacts;
  }

  // ─── Single-entity upserts (called on individual mutations) ───

  async upsertContact(contact: CRMContact): Promise<void> {
    if (!this.ready || !supabase) return;
    // Ensure clinic + market exist
    await this.syncMarkets([contact.clinic.marketZone]);
    await this.syncClinics([contact.clinic]);
    if (contact.decisionMaker) await this.upsertDecisionMaker(contact.decisionMaker);

    const row = {
      id: contact.id, clinic_id: contact.clinic.id,
      decision_maker_id: contact.decisionMaker?.id || null,
      status: contact.status, priority: contact.priority, score: contact.score,
      tags: contact.tags || [], notes: contact.notes || '',
      created_at: iso(contact.createdAt), updated_at: iso(contact.updatedAt),
      last_contacted_at: iso(contact.lastContactedAt),
      next_follow_up: iso(contact.nextFollowUp),
    };
    const { error } = await supabase.from('contacts').upsert(row, { onConflict: 'id' });
    if (error) console.error('upsertContact error:', error.message);

    // Sync keyword matches
    if (contact.keywordMatches?.length) {
      await this.syncKeywordTrends(contact.keywordMatches);
      await supabase.from('contact_keyword_matches').delete().eq('contact_id', contact.id);
      await supabase.from('contact_keyword_matches').insert(
        contact.keywordMatches.map(km => ({ contact_id: contact.id, keyword_trend_id: km.id }))
      );
    }

    // Sync activities
    if (contact.activities?.length) {
      const actRows = contact.activities.map(a => activityToRow(a, contact.id));
      await supabase.from('activities').upsert(actRows, { onConflict: 'id' });
    }
  }

  async addActivity(contactId: string, activity: Activity): Promise<void> {
    if (!this.ready || !supabase) return;
    const { error } = await supabase.from('activities').upsert(activityToRow(activity, contactId), { onConflict: 'id' });
    if (error) console.error('addActivity error:', error.message);
  }

  async updateContactFields(contactId: string, updates: Record<string, any>): Promise<void> {
    if (!this.ready || !supabase) return;
    // Map camelCase to snake_case for known fields
    const mapped: Record<string, any> = { updated_at: new Date().toISOString() };
    if ('status' in updates) mapped.status = updates.status;
    if ('priority' in updates) mapped.priority = updates.priority;
    if ('score' in updates) mapped.score = updates.score;
    if ('notes' in updates) mapped.notes = updates.notes;
    if ('tags' in updates) mapped.tags = updates.tags;
    if ('lastContactedAt' in updates) mapped.last_contacted_at = iso(updates.lastContactedAt);
    if ('nextFollowUp' in updates) mapped.next_follow_up = iso(updates.nextFollowUp);
    if ('decisionMaker' in updates && updates.decisionMaker) {
      await this.upsertDecisionMaker(updates.decisionMaker);
      mapped.decision_maker_id = updates.decisionMaker.id;
    }
    if ('clinic' in updates && updates.clinic) {
      await this.syncClinics([updates.clinic]);
    }

    const { error } = await supabase.from('contacts').update(mapped).eq('id', contactId);
    if (error) console.error('updateContactFields error:', error.message);
  }

  // ─── Voice Calls ───
  async syncVoiceCalls(calls: VoiceCall[]): Promise<void> {
    if (!this.ready || !supabase || !calls.length) return;
    const rows = calls.map(callToRow);
    const contactIds = [...new Set(rows.map(r => r.contact_id).filter(Boolean))];

    let validContactIds = new Set<string>();
    if (contactIds.length > 0) {
      const { data, error: contactsError } = await supabase
        .from('contacts')
        .select('id')
        .in('id', contactIds);
      if (contactsError) {
        console.error('syncVoiceCalls contact precheck error:', contactsError.message);
      } else {
        validContactIds = new Set((data || []).map(c => c.id));
      }
    }

    const rowsToSync =
      contactIds.length > 0
        ? rows.filter(r => !r.contact_id || validContactIds.has(r.contact_id))
        : rows;

    const droppedRows = rows.length - rowsToSync.length;
    if (droppedRows > 0) {
      console.warn(`syncVoiceCalls skipped ${droppedRows} orphan call(s) with missing contact_id FK.`);
    }
    if (!rowsToSync.length) return;

    const { error } = await supabase.from('voice_calls').upsert(rowsToSync, { onConflict: 'id' });
    if (error) console.error('syncVoiceCalls error:', error.message);
  }

  async fetchVoiceCalls(): Promise<{ active: VoiceCall[]; history: VoiceCall[] } | null> {
    if (!this.ready || !supabase) return null;
    let data: any[] = [];
    try {
      data = await this.fetchAllRows('voice_calls');
    } catch {
      return null;
    }
    if (!data.length) return null;
    const all = data.map(rowToCall);
    return {
      active: all.filter(c => ['queued', 'ringing', 'in_progress'].includes(c.status)),
      history: all.filter(c => !['queued', 'ringing', 'in_progress'].includes(c.status)),
    };
  }

  // ─── Campaigns ───
  async syncCampaigns(campaigns: Campaign[]): Promise<void> {
    if (!this.ready || !supabase || !campaigns.length) return;
    const rows = campaigns.map(campaignToRow);
    const { error } = await supabase.from('campaigns').upsert(rows, { onConflict: 'id' });
    if (error) console.error('syncCampaigns error:', error.message);
  }

  async fetchCampaigns(): Promise<Campaign[] | null> {
    if (!this.ready || !supabase) return null;
    let data: any[] = [];
    try {
      data = await this.fetchAllRows('campaigns');
    } catch {
      return null;
    }
    if (!data.length) return null;
    return data.map(rowToCampaign);
  }

  // ─── Full sync: push local → Supabase ───
  async pushAll(state: {
    markets: MarketZone[];
    clinics: Clinic[];
    contacts: CRMContact[];
    keywordTrends: KeywordTrend[];
    activeCalls: VoiceCall[];
    callHistory: VoiceCall[];
    campaigns: Campaign[];
  }): Promise<void> {
    if (!this.ready) return;
    console.log('Pushing all data to Supabase...');
    await this.syncMarkets(state.markets);
    await this.syncClinics(state.clinics);
    await this.syncKeywordTrends(state.keywordTrends);
    await this.syncContacts(state.contacts);
    await this.syncVoiceCalls([...state.activeCalls, ...state.callHistory]);
    await this.syncCampaigns(state.campaigns);
    console.log('✓ Full push complete');
  }

  // ─── Full sync: pull Supabase → local ───
  async pullAll(currentMarkets: MarketZone[]): Promise<{
    markets: MarketZone[];
    clinics: Clinic[];
    contacts: CRMContact[];
    keywordTrends: KeywordTrend[];
    activeCalls: VoiceCall[];
    callHistory: VoiceCall[];
    campaigns: Campaign[];
  } | null> {
    if (!this.ready) return null;
    console.log('Pulling all data from Supabase...');

    const markets = await this.fetchMarkets() || currentMarkets;
    const marketMap = Object.fromEntries(markets.map(m => [m.id, m]));
    const clinics = await this.fetchClinics(marketMap) || [];
    const keywordTrends = await this.fetchKeywordTrends(marketMap) || [];
    const contacts = await this.fetchContacts(marketMap) || [];
    const calls = await this.fetchVoiceCalls();
    const campaigns = await this.fetchCampaigns() || [];

    console.log(`✓ Pulled: ${markets.length} markets, ${clinics.length} clinics, ${contacts.length} contacts, ${keywordTrends.length} trends`);
    return {
      markets, clinics, contacts, keywordTrends,
      activeCalls: calls?.active || [],
      callHistory: calls?.history || [],
      campaigns,
    };
  }

  // ─── Delete all rows from a table ───
  async deleteAllKeywordTrends(): Promise<void> {
    if (!this.ready || !supabase) return;
    const { error } = await supabase.from('keyword_trends').delete().neq('id', '');
    if (error) console.error('deleteAllKeywordTrends error:', error.message);
    else console.log('✓ Cleared keyword_trends from Supabase');
  }

  async deleteAllClinics(): Promise<void> {
    if (!this.ready || !supabase) return;
    const { error } = await supabase.from('clinics').delete().neq('id', '');
    if (error) console.error('deleteAllClinics error:', error.message);
    else console.log('✓ Cleared clinics from Supabase');
  }

  async deleteAllContacts(): Promise<void> {
    if (!this.ready || !supabase) return;
    // Delete junction table first (foreign key constraint)
    await supabase.from('contact_keyword_matches').delete().neq('contact_id', '');
    const { error } = await supabase.from('contacts').delete().neq('id', '');
    if (error) console.error('deleteAllContacts error:', error.message);
    else console.log('✓ Cleared contacts from Supabase');
  }

  async deleteAllCalls(): Promise<void> {
    if (!this.ready || !supabase) return;
    const { error } = await supabase.from('voice_calls').delete().neq('id', '');
    if (error) console.error('deleteAllCalls error:', error.message);
    else console.log('✓ Cleared voice_calls from Supabase');
  }

  async deleteAllCampaigns(): Promise<void> {
    if (!this.ready || !supabase) return;
    const { error } = await supabase.from('campaigns').delete().neq('id', '');
    if (error) console.error('deleteAllCampaigns error:', error.message);
    else console.log('✓ Cleared campaigns from Supabase');
  }

  /** Nuclear option — delete all user data from Supabase */
  async deleteAll(): Promise<void> {
    if (!this.ready || !supabase) return;
    console.log('🗑️ Deleting all data from Supabase...');
    await this.deleteAllCalls();
    await this.deleteAllCampaigns();
    await this.deleteAllContacts();
    await this.deleteAllKeywordTrends();
    await this.deleteAllClinics();
    console.log('✓ All Supabase data deleted');
  }
}

export const supabaseSync = new SupabaseSyncService();
