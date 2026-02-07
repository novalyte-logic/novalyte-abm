import { create } from 'zustand';
import { 
  CRMContact, 
  KeywordTrend, 
  MarketZone, 
  Clinic, 
  VoiceCall, 
  Campaign,
  ContactStatus,
  AFFLUENT_MARKETS 
} from '../types';

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
  
  // UI State
  currentView: 'dashboard' | 'keywords' | 'clinics' | 'crm' | 'voice' | 'campaigns';
  
  // Actions
  setMarkets: (markets: MarketZone[]) => void;
  selectMarket: (market: MarketZone | null) => void;
  
  addKeywordTrends: (trends: KeywordTrend[]) => void;
  setIsScanning: (isScanning: boolean) => void;
  
  addClinics: (clinics: Clinic[]) => void;
  setIsDiscovering: (isDiscovering: boolean) => void;
  
  addContact: (contact: CRMContact) => void;
  updateContact: (id: string, updates: Partial<CRMContact>) => void;
  selectContact: (contact: CRMContact | null) => void;
  updateContactStatus: (id: string, status: ContactStatus) => void;
  
  addCall: (call: VoiceCall) => void;
  updateCall: (id: string, updates: Partial<VoiceCall>) => void;
  completeCall: (id: string, updates: Partial<VoiceCall>) => void;
  
  setCampaigns: (campaigns: Campaign[]) => void;
  setActiveCampaign: (campaign: Campaign | null) => void;
  
  setCurrentView: (view: AppState['currentView']) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
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
  
  currentView: 'dashboard',
  
  // Actions
  setMarkets: (markets) => set({ markets }),
  selectMarket: (market) => set({ selectedMarket: market }),
  
  addKeywordTrends: (trends) => set((state) => ({
    keywordTrends: [...state.keywordTrends, ...trends],
  })),
  setIsScanning: (isScanning) => set({ isScanning }),
  
  addClinics: (clinics) => set((state) => {
    const existingIds = new Set(state.clinics.map(c => c.id));
    const newClinics = clinics.filter(c => !existingIds.has(c.id));
    return { clinics: [...state.clinics, ...newClinics] };
  }),
  setIsDiscovering: (isDiscovering) => set({ isDiscovering }),
  
  addContact: (contact) => set((state) => ({
    contacts: [...state.contacts, contact],
  })),
  
  updateContact: (id, updates) => set((state) => ({
    contacts: state.contacts.map(c => 
      c.id === id ? { ...c, ...updates, updatedAt: new Date() } : c
    ),
  })),
  
  selectContact: (contact) => set({ selectedContact: contact }),
  
  updateContactStatus: (id, status) => set((state) => ({
    contacts: state.contacts.map(c =>
      c.id === id ? { ...c, status, updatedAt: new Date() } : c
    ),
  })),
  
  addCall: (call) => set((state) => ({
    activeCalls: [...state.activeCalls, call],
  })),
  
  updateCall: (id, updates) => set((state) => ({
    activeCalls: state.activeCalls.map(c =>
      c.id === id ? { ...c, ...updates } : c
    ),
  })),
  
  completeCall: (id, updates) => set((state) => {
    const call = state.activeCalls.find(c => c.id === id);
    if (!call) return state;
    
    const completedCall = { ...call, ...updates };
    
    return {
      activeCalls: state.activeCalls.filter(c => c.id !== id),
      callHistory: [...state.callHistory, completedCall],
    };
  }),
  
  setCampaigns: (campaigns) => set({ campaigns }),
  setActiveCampaign: (campaign) => set({ activeCampaign: campaign }),
  
  setCurrentView: (view) => set({ currentView: view }),
}));
