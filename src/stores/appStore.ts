import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  CRMContact, KeywordTrend, MarketZone, Clinic, VoiceCall, Campaign,
  ContactStatus, AFFLUENT_MARKETS,
} from '../types';
import { supabaseSync } from '../services/supabaseSync';
import { SentEmail } from '../services/resendService';
import { enrichmentService } from '../services/enrichmentService';
import { computeLeadScore } from '../utils/leadScoring';

interface AppState {
  // Markets
  markets: MarketZone[];
  selectedMarket: MarketZone | null;
  // Keyword trends
  keywordTrends: KeywordTrend[];
  isScanning: boolean;
  // Clinics
  clinics: Clinic[];
  isDiscovering: boolean;
  // CRM
  contacts: CRMContact[];
  selectedContact: CRMContact | null;
  // Voice calls
  activeCalls: VoiceCall[];
  callHistory: VoiceCall[];
  // Campaigns
  campaigns: Campaign[];
  activeCampaign: Campaign | null;
  // Email outreach
  sentEmails: SentEmail[];
  // UI State
  currentView: 'dashboard' | 'keywords' | 'clinics' | 'crm' | 'voice' | 'campaigns' | 'email' | 'forecast';
  // Supabase
  supabaseReady: boolean;
  isSyncing: boolean;

  // Actions
  setMarkets: (markets: MarketZone[]) => void;
  selectMarket: (market: MarketZone | null) => void;
  addKeywordTrends: (trends: KeywordTrend[]) => void;
  setIsScanning: (isScanning: boolean) => void;
  addClinics: (clinics: Clinic[]) => void;
  updateClinic: (id: string, updates: Partial<Clinic>) => void;
  setIsDiscovering: (isDiscovering: boolean) => void;
  addContact: (contact: CRMContact) => void;
  addContacts: (contacts: CRMContact[]) => void;
  updateContact: (id: string, updates: Partial<CRMContact>) => void;
  selectContact: (contact: CRMContact | null) => void;
  updateContactStatus: (id: string, status: ContactStatus) => void;
  addCall: (call: VoiceCall) => void;
  updateCall: (id: string, updates: Partial<VoiceCall>) => void;
  completeCall: (id: string, updates: Partial<VoiceCall>) => void;
  clearStaleCalls: () => void;
  setCampaigns: (campaigns: Campaign[]) => void;
  setActiveCampaign: (campaign: Campaign | null) => void;
  addSentEmails: (emails: SentEmail[]) => void;
  updateSentEmails: (emails: SentEmail[]) => void;
  setCurrentView: (view: AppState['currentView']) => void;
  // Supabase actions
  initSupabase: () => Promise<void>;
  pushToSupabase: () => Promise<void>;
  pullFromSupabase: () => Promise<void>;
}

/** Fire-and-forget Supabase sync — never blocks the UI */
function bgSync(fn: () => Promise<void>) {
  fn().catch(err => console.warn('Supabase sync error:', err));
}

/** Background auto-enrichment for newly added contacts */
function bgAutoEnrich(contacts: CRMContact[], set: any, get: any) {
  (async () => {
    for (const contact of contacts) {
      if (contact.decisionMaker) continue; // already enriched
      try {
        const dms = await enrichmentService.findDecisionMakers(contact.clinic);
        if (dms.length === 0) continue;
        const rolePriority = ['owner', 'medical_director', 'clinic_manager', 'practice_administrator', 'operations_manager', 'marketing_director'];
        const withEmail = dms.filter(d => !!d.email);
        const best = withEmail.length > 0
          ? (rolePriority.reduce<typeof dms[number] | null>((f, r) => f || withEmail.find(d => d.role === r) || null, null) || withEmail.reduce((a, b) => a.confidence > b.confidence ? a : b))
          : dms.reduce((a, b) => a.confidence > b.confidence ? a : b);

        const updatedContact: CRMContact = { ...contact, decisionMaker: best, clinic: { ...contact.clinic, managerName: `${best.firstName} ${best.lastName}`.trim(), managerEmail: best.email } };
        const { score, priority } = computeLeadScore(updatedContact);

        set((state: any) => ({
          contacts: state.contacts.map((c: any) =>
            c.id === contact.id ? { ...c, decisionMaker: best, clinic: { ...c.clinic, managerName: `${best.firstName} ${best.lastName}`.trim(), managerEmail: best.email }, score, priority, status: best.email ? 'ready_to_call' : c.status, updatedAt: new Date() } : c
          ),
        }));
        bgSync(() => supabaseSync.updateContactFields(contact.id, { decisionMaker: best, score, priority }));
      } catch (err) {
        console.warn(`Auto-enrich failed for ${contact.clinic.name}:`, err);
      }
      // Rate limit: 500ms between enrichments
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`✓ Auto-enriched ${contacts.length} contacts`);
  })().catch(err => console.warn('Auto-enrichment error:', err));
}

const createPersistedStore = (persist as any)((set: any, get: any) => ({
  // Initial state
  markets: AFFLUENT_MARKETS.map((m, i) => ({ ...m, id: `market-${i}` })),
  selectedMarket: null,
  keywordTrends: [],
  isScanning: false,
  clinics: [],
  isDiscovering: false,
  contacts: [],
  selectedContact: null,
  activeCalls: [],
  callHistory: [],
  campaigns: [],
  activeCampaign: null,
  sentEmails: [],
  currentView: 'dashboard',
  supabaseReady: false,
  isSyncing: false,

  // ─── Actions ───

  setMarkets: (markets: any) => {
    set({ markets });
    bgSync(() => supabaseSync.syncMarkets(markets));
  },
  selectMarket: (market: any) => set({ selectedMarket: market }),

  addKeywordTrends: (trends: any) => {
    set((state: any) => ({ keywordTrends: [...state.keywordTrends, ...trends] }));
    bgSync(() => supabaseSync.syncKeywordTrends(trends));
  },
  setIsScanning: (isScanning: boolean) => set({ isScanning }),

  addClinics: (clinics: any) => {
    let added: any[] = [];
    set((state: any) => {
      // Dedup by id AND googlePlaceId to prevent any duplicates
      const existingIds = new Set(state.clinics.map((c: any) => c.id));
      const existingPlaceIds = new Set(
        state.clinics.map((c: any) => c.googlePlaceId).filter(Boolean)
      );
      const seen = new Set<string>(); // track within this batch too
      const newClinics = clinics.filter((c: any) => {
        if (existingIds.has(c.id)) return false;
        if (c.googlePlaceId && existingPlaceIds.has(c.googlePlaceId)) return false;
        // Batch-level dedup
        const batchKey = c.googlePlaceId || c.id;
        if (seen.has(batchKey)) return false;
        seen.add(batchKey);
        return true;
      });
      added = newClinics;
      if (newClinics.length === 0) return state;
      return { clinics: [...state.clinics, ...newClinics] };
    });
    if (added.length > 0) {
      bgSync(() => supabaseSync.syncClinics(added));
    }
  },

  updateClinic: (id: string, updates: Partial<any>) => {
    set((state: any) => ({
      clinics: state.clinics.map((c: any) => c.id === id ? { ...c, ...updates, lastUpdated: new Date() } : c),
    }));
    bgSync(async () => {
      const clinic = get().clinics.find((c: any) => c.id === id);
      if (clinic) await supabaseSync.syncClinics([clinic]);
    });
  },
  setIsDiscovering: (isDiscovering: boolean) => set({ isDiscovering }),

  addContact: (contact: any) => {
    let wasAdded = false;
    set((state: any) => {
      // Dedup by clinic.id AND clinic.googlePlaceId
      const isDup = state.contacts.some((c: any) =>
        c.clinic.id === contact.clinic.id
        || (contact.clinic.googlePlaceId && c.clinic.googlePlaceId === contact.clinic.googlePlaceId)
      );
      if (isDup) return state;
      wasAdded = true;
      return { contacts: [...state.contacts, contact] };
    });
    if (wasAdded) bgSync(() => supabaseSync.upsertContact(contact));
  },

  addContacts: (newContacts: any) => {
    let added: any[] = [];
    set((state: any) => {
      const existingClinicIds = new Set(state.contacts.map((c: any) => c.clinic.id));
      const existingPlaceIds = new Set(
        state.contacts.map((c: any) => c.clinic.googlePlaceId).filter(Boolean)
      );
      const seen = new Set<string>();
      const unique = newContacts.filter((c: any) => {
        if (existingClinicIds.has(c.clinic.id)) return false;
        if (c.clinic.googlePlaceId && existingPlaceIds.has(c.clinic.googlePlaceId)) return false;
        const batchKey = c.clinic.googlePlaceId || c.clinic.id;
        if (seen.has(batchKey)) return false;
        seen.add(batchKey);
        return true;
      });
      added = unique;
      if (unique.length === 0) return state;
      return { contacts: [...state.contacts, ...unique] };
    });
    if (added.length > 0) {
      bgSync(async () => {
        for (const c of added) await supabaseSync.upsertContact(c);
      });
      // Feature #6: Auto-enrichment — background enrich each new contact
      bgAutoEnrich(added, set, get);
    }
  },

  updateContact: (id: string, updates: Partial<any>) => {
    set((state: any) => ({
      contacts: state.contacts.map((c: any) =>
        c.id === id ? { ...c, ...updates, updatedAt: new Date() } : c
      ),
    }));
    bgSync(() => supabaseSync.updateContactFields(id, updates));
  },

  selectContact: (contact: any) => set({ selectedContact: contact }),

  updateContactStatus: (id: string, status: any) => {
    set((state: any) => ({
      contacts: state.contacts.map((c: any) =>
        c.id === id ? { ...c, status, updatedAt: new Date() } : c
      ),
    }));
    bgSync(() => supabaseSync.updateContactFields(id, { status }));
  },

  addCall: (call: any) => {
    set((state: any) => ({ activeCalls: [...state.activeCalls, call] }));
    bgSync(() => supabaseSync.syncVoiceCalls([call]));
  },

  updateCall: (id: string, updates: Partial<any>) => {
    set((state: any) => ({
      activeCalls: state.activeCalls.map((c: any) => c.id === id ? { ...c, ...updates } : c),
    }));
    bgSync(async () => {
      const call = get().activeCalls.find((c: any) => c.id === id);
      if (call) await supabaseSync.syncVoiceCalls([call]);
    });
  },

  completeCall: (id: string, updates: Partial<any>) => {
    let completed: any = null;
    set((state: any) => {
      const call = state.activeCalls.find((c: any) => c.id === id);
      if (!call) return state;
      completed = { ...call, ...updates };
      return {
        activeCalls: state.activeCalls.filter((c: any) => c.id !== id),
        callHistory: [...state.callHistory, completed],
      };
    });
    if (completed) bgSync(() => supabaseSync.syncVoiceCalls([completed]));
  },

  clearStaleCalls: () => {
    set((state: any) => {
      if (!state.activeCalls.length) return state;
      const moved = state.activeCalls.map((c: any) => ({
        ...c, status: 'completed', notes: c.notes || 'Manually cleared from active calls',
      }));
      return {
        activeCalls: [],
        callHistory: [...state.callHistory, ...moved],
      };
    });
  },

  setCampaigns: (campaigns: any) => {
    set({ campaigns });
    bgSync(() => supabaseSync.syncCampaigns(campaigns));
  },
  setActiveCampaign: (campaign: any) => set({ activeCampaign: campaign }),

  addSentEmails: (emails: SentEmail[]) => {
    set((state: any) => ({ sentEmails: [...state.sentEmails, ...emails] }));
  },
  updateSentEmails: (emails: SentEmail[]) => {
    set((state: any) => {
      const map = new Map(state.sentEmails.map((e: SentEmail) => [e.id, e]));
      for (const e of emails) map.set(e.id, e);
      return { sentEmails: Array.from(map.values()) };
    });
  },

  setCurrentView: (view: any) => set({ currentView: view }),

  // ─── Supabase lifecycle ───

  initSupabase: async () => {
    const ok = await supabaseSync.init();
    set({ supabaseReady: ok });
    if (ok) {
      // Pull remote data — merge with local
      const state = get();
      const remote = await supabaseSync.pullAll(state.markets);
      if (remote) {
        // Merge: remote wins for contacts/clinics/trends, local wins for UI state
        const mergedContacts = mergeById(state.contacts, remote.contacts);
        const mergedClinics = mergeById(state.clinics, remote.clinics);
        const mergedTrends = mergeById(state.keywordTrends, remote.keywordTrends);
        set({
          markets: remote.markets.length > 0 ? remote.markets : state.markets,
          clinics: mergedClinics,
          contacts: mergedContacts,
          keywordTrends: mergedTrends,
          activeCalls: remote.activeCalls.length > 0 ? remote.activeCalls : state.activeCalls,
          callHistory: remote.callHistory.length > 0 ? remote.callHistory : state.callHistory,
          campaigns: remote.campaigns.length > 0 ? remote.campaigns : state.campaigns,
        });
        console.log('✓ Supabase data merged');
      }
      // Push any local-only data to Supabase
      const fresh = get();
      bgSync(() => supabaseSync.pushAll({
        markets: fresh.markets,
        clinics: fresh.clinics,
        contacts: fresh.contacts,
        keywordTrends: fresh.keywordTrends,
        activeCalls: fresh.activeCalls,
        callHistory: fresh.callHistory,
        campaigns: fresh.campaigns,
      }));
    }
  },

  pushToSupabase: async () => {
    if (!supabaseSync.isReady) return;
    set({ isSyncing: true });
    const state = get();
    await supabaseSync.pushAll({
      markets: state.markets,
      clinics: state.clinics,
      contacts: state.contacts,
      keywordTrends: state.keywordTrends,
      activeCalls: state.activeCalls,
      callHistory: state.callHistory,
      campaigns: state.campaigns,
    });
    set({ isSyncing: false });
  },

  pullFromSupabase: async () => {
    if (!supabaseSync.isReady) return;
    set({ isSyncing: true });
    const state = get();
    const remote = await supabaseSync.pullAll(state.markets);
    if (remote) {
      set({
        markets: remote.markets,
        clinics: remote.clinics,
        contacts: remote.contacts,
        keywordTrends: remote.keywordTrends,
        activeCalls: remote.activeCalls,
        callHistory: remote.callHistory,
        campaigns: remote.campaigns,
      });
    }
    set({ isSyncing: false });
  },
}), {
  name: 'novalyte-store',
  partialize: (state: any) => ({
    markets: state.markets,
    selectedMarket: state.selectedMarket,
    keywordTrends: state.keywordTrends,
    clinics: state.clinics,
    isDiscovering: state.isDiscovering,
    contacts: state.contacts,
    selectedContact: state.selectedContact,
    activeCalls: state.activeCalls,
    callHistory: state.callHistory,
    campaigns: state.campaigns,
    activeCampaign: state.activeCampaign,
    sentEmails: state.sentEmails,
    currentView: state.currentView,
  }),
  onRehydrateStorage: () => (state: any) => {
    if (!state) return;
    try {
      if (Array.isArray(state.clinics)) {
        state.clinics = state.clinics.map((c: any) => ({
          ...c,
          discoveredAt: c.discoveredAt ? new Date(c.discoveredAt) : new Date(),
          lastUpdated: c.lastUpdated ? new Date(c.lastUpdated) : new Date(),
        }));
      }
      if (Array.isArray(state.contacts)) {
        state.contacts = state.contacts.map((ct: any) => ({
          ...ct,
          createdAt: ct.createdAt ? new Date(ct.createdAt) : new Date(),
          updatedAt: ct.updatedAt ? new Date(ct.updatedAt) : new Date(),
          lastContactedAt: ct.lastContactedAt ? new Date(ct.lastContactedAt) : undefined,
          nextFollowUp: ct.nextFollowUp ? new Date(ct.nextFollowUp) : undefined,
          clinic: ct.clinic ? {
            ...ct.clinic,
            discoveredAt: ct.clinic.discoveredAt ? new Date(ct.clinic.discoveredAt) : new Date(),
            lastUpdated: ct.clinic.lastUpdated ? new Date(ct.clinic.lastUpdated) : new Date(),
          } : ct.clinic,
          decisionMaker: ct.decisionMaker ? {
            ...ct.decisionMaker,
            enrichedAt: ct.decisionMaker.enrichedAt ? new Date(ct.decisionMaker.enrichedAt) : undefined,
          } : undefined,
          keywordMatches: Array.isArray(ct.keywordMatches)
            ? ct.keywordMatches.map((km: any) => ({ ...km, timestamp: km.timestamp ? new Date(km.timestamp) : new Date() }))
            : ct.keywordMatches,
          activities: Array.isArray(ct.activities)
            ? ct.activities.map((a: any) => ({ ...a, timestamp: a.timestamp ? new Date(a.timestamp) : new Date() }))
            : [],
        }));
      }
      if (Array.isArray(state.activeCalls)) {
        // Clean up stale active calls — if a call has been "active" for more than 10 minutes,
        // it's almost certainly done. Move it to history so it doesn't show as phantom active calls.
        const TEN_MINUTES = 10 * 60 * 1000;
        const now = Date.now();
        const stale: any[] = [];
        const stillActive: any[] = [];
        for (const call of state.activeCalls) {
          const start = call.startTime ? new Date(call.startTime).getTime() : 0;
          const age = now - start;
          const rehydrated = {
            ...call,
            startTime: call.startTime ? new Date(call.startTime) : new Date(),
            endTime: call.endTime ? new Date(call.endTime) : undefined,
          };
          if (age > TEN_MINUTES) {
            stale.push({ ...rehydrated, status: 'completed', notes: 'Auto-completed: stale after page reload' });
          } else {
            stillActive.push(rehydrated);
          }
        }
        state.activeCalls = stillActive;
        if (stale.length > 0) {
          state.callHistory = [...(state.callHistory || []), ...stale];
          console.info(`[Rehydrate] Moved ${stale.length} stale active call(s) to history`);
        }
      }
      if (Array.isArray(state.callHistory)) {
        state.callHistory = state.callHistory.map((call: any) => ({
          ...call,
          startTime: call.startTime ? new Date(call.startTime) : new Date(),
          endTime: call.endTime ? new Date(call.endTime) : undefined,
        }));
      }
      if (Array.isArray(state.campaigns)) {
        state.campaigns = state.campaigns.map((camp: any) => ({
          ...camp,
          startDate: camp.startDate ? new Date(camp.startDate) : undefined,
          endDate: camp.endDate ? new Date(camp.endDate) : undefined,
          createdAt: camp.createdAt ? new Date(camp.createdAt) : new Date(),
          updatedAt: camp.updatedAt ? new Date(camp.updatedAt) : new Date(),
        }));
      }
      if (Array.isArray(state.keywordTrends)) {
        state.keywordTrends = state.keywordTrends.map((t: any) => ({
          ...t,
          timestamp: t.timestamp ? new Date(t.timestamp) : new Date(),
        }));
      }
      if (Array.isArray(state.sentEmails)) {
        state.sentEmails = state.sentEmails.map((e: any) => ({
          ...e,
          sentAt: e.sentAt ? new Date(e.sentAt) : new Date(),
          lastEventAt: e.lastEventAt ? new Date(e.lastEventAt) : new Date(),
        }));
      }
    } catch (err) {
      console.warn('Error rehydrating persisted state dates', err);
    }
  },
});

/** Merge two arrays by id — remote items overwrite local ones */
function mergeById<T extends { id: string }>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) map.set(item.id, item); // remote wins
  return Array.from(map.values());
}

export const useAppStore = create<AppState>(createPersistedStore as any);
