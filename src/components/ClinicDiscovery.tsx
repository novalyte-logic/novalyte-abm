import { useState, useMemo } from 'react';
import {
  Building2, Search, RefreshCw, MapPin, Star, Phone, Globe, Plus,
  ExternalLink, Users, Radar, X, ChevronDown, ChevronUp,
  UserSearch, Trash2, CheckCircle2, LayoutGrid, LayoutList, Mail, Download,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { clinicService } from '../services/clinicService';
import { discoveryService } from '../services/discoveryService';
import { enrichmentService } from '../services/enrichmentService';
import { Clinic, CRMContact, MarketZone } from '../types';
import { computeLeadScore } from '../utils/leadScoring';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';

type SortKey = 'name' | 'rating' | 'reviewCount' | 'type' | 'market';
type SortDir = 'asc' | 'desc';
type ViewMode = 'table' | 'grid';

function ClinicDiscovery() {
  const {
    markets, selectedMarket, selectMarket,
    clinics, addClinics, updateClinic,
    isDiscovering, setIsDiscovering,
    addContact, addContacts, contacts, keywordTrends,
  } = useAppStore();

  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState<string | null>(null);
  const [discoveryStats, setDiscoveryStats] = useState<{ marketsScanned: number; totalFound: number } | null>(null);
  const [selectedClinic, setSelectedClinic] = useState<Clinic | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('rating');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  // ─── Helpers ───

  const isInCRM = (c: Clinic) => contacts.some(ct =>
    ct.clinic.id === c.id || (c.googlePlaceId && ct.clinic.googlePlaceId === c.googlePlaceId)
  );

  const getTypeLabel = (type: Clinic['type']) => {
    const labels: Record<Clinic['type'], string> = {
      mens_health_clinic: "Men's Health", hormone_clinic: 'Hormone / TRT',
      med_spa: 'Med Spa', urology_practice: 'Urology',
      anti_aging_clinic: 'Anti-Aging', wellness_center: 'Wellness',
      aesthetic_clinic: 'Aesthetic',
    };
    return labels[type] || type;
  };

  const mapPlaceToClinic = (place: any, market: MarketZone): Clinic => {
    const name = place.name || 'Unknown Clinic';
    const addrParts = (place.address || '').split(',').map((s: string) => s.trim());
    const street = addrParts[0] || '';
    const city = addrParts.length >= 2 ? addrParts[1] : market.city;
    const stateZip = addrParts.length >= 3 ? addrParts[2] : market.state;
    const state = (stateZip || '').split(' ')[0] || market.state;
    const zipMatch = (stateZip || '').match(/\b\d{5}\b/);
    const zip = zipMatch ? zipMatch[0] : '';
    const nl = name.toLowerCase();
    let type: Clinic['type'] = 'mens_health_clinic';
    if (nl.includes('urology')) type = 'urology_practice';
    else if (nl.includes('med spa') || nl.includes('medspa')) type = 'med_spa';
    else if (nl.includes('hormone') || nl.includes('trt') || nl.includes('testosterone')) type = 'hormone_clinic';
    else if (nl.includes('anti-aging') || nl.includes('longevity')) type = 'anti_aging_clinic';
    else if (nl.includes('wellness') || nl.includes('vitality')) type = 'wellness_center';
    else if (nl.includes('aesthetic')) type = 'aesthetic_clinic';
    const services: string[] = [];
    if (nl.includes('trt') || nl.includes('testosterone')) services.push('TRT', 'Hormone Therapy');
    if (nl.includes('iv') || nl.includes('infusion')) services.push('IV Therapy');
    if (nl.includes('peptide')) services.push('Peptide Therapy');
    if (nl.includes('weight') || nl.includes('glp') || nl.includes('semaglutide')) services.push('Weight Loss', 'GLP-1');
    if (nl.includes('hair') || nl.includes('restoration')) services.push('Hair Restoration');
    if (nl.includes('sexual') || nl.includes('erectile')) services.push('ED Treatment');
    if (nl.includes('urology')) services.push('Urology');
    if (nl.includes('med spa') || nl.includes('medspa')) services.push('Aesthetics', 'IV Therapy');
    return {
      id: place.placeId ? `clinic-${place.placeId}` : `clinic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name, type,
      address: { street, city, state, zip, country: 'USA' },
      phone: place.phone || '', website: place.website || undefined,
      googlePlaceId: place.placeId || undefined,
      rating: place.rating ?? undefined, reviewCount: place.reviewCount ?? undefined,
      services: services.length > 0 ? services : ["Men's Health"],
      marketZone: market, discoveredAt: new Date(), lastUpdated: new Date(),
    };
  };

  const selectBestDM = (dms: any[]) => {
    if (!dms?.length) return null;
    const rolePriority = ['owner', 'medical_director', 'clinic_manager', 'practice_administrator', 'operations_manager', 'marketing_director'];
    const withEmail = dms.filter((d: any) => !!d.email);
    for (const role of rolePriority) {
      const found = withEmail.find((d: any) => d.role === role);
      if (found) return found;
    }
    if (withEmail.length > 0) return withEmail.reduce((a: any, b: any) => a.confidence > b.confidence ? a : b);
    return dms.reduce((a: any, b: any) => a.confidence > b.confidence ? a : b);
  };

  // ─── Handlers ───

  const handleDiscoverClinics = async () => {
    if (!selectedMarket) { toast.error('Select a market first'); return; }
    setIsDiscovering(true);
    setDiscoveryProgress(`Scanning ${selectedMarket.city}...`);
    toast.loading('Discovering clinics...', { id: 'discovering' });
    try {
      const found = await clinicService.discoverClinicsInMarket(selectedMarket);
      addClinics(found);
      toast.success(`Found ${found.length} clinics in ${selectedMarket.city}`, { id: 'discovering' });
    } catch { toast.error('Failed to discover clinics', { id: 'discovering' }); }
    finally { setIsDiscovering(false); setDiscoveryProgress(null); }
  };

  const handleDiscoverAllMarkets = async () => {
    setIsDiscovering(true);
    setDiscoveryStats({ marketsScanned: 0, totalFound: 0 });
    setDiscoveryProgress('Starting full market scan...');
    toast.loading('Discovering clinics across all markets...', { id: 'disc-all' });
    let totalFound = 0, marketsScanned = 0;
    try {
      await discoveryService.discoverAllMarkets(markets, {
        onProgress: (msg, found) => { setDiscoveryProgress(msg); totalFound = found; setDiscoveryStats({ marketsScanned, totalFound }); },
        onMarketComplete: (market, places) => {
          marketsScanned++;
          const newClinics = places.map(p => mapPlaceToClinic(p, market));
          if (newClinics.length > 0) addClinics(newClinics);
          setDiscoveryStats({ marketsScanned, totalFound: totalFound + places.length });
          toast.loading(`${marketsScanned}/${markets.length} markets — ${newClinics.length} in ${market.city}`, { id: 'disc-all' });
        },
      });
      toast.success(`Discovery complete — ${useAppStore.getState().clinics.length} total clinics`, { id: 'disc-all' });
    } catch { toast.error('Discovery interrupted — partial results saved', { id: 'disc-all' }); }
    finally { setIsDiscovering(false); setDiscoveryProgress(null); setDiscoveryStats(null); }
  };

  const handleAddToCRM = async (clinic: Clinic) => {
    if (isInCRM(clinic)) { toast.error(`${clinic.name} is already in CRM`); return; }
    toast.loading('Adding to CRM...', { id: 'adding' });
    try {
      const dms = await enrichmentService.findDecisionMakers(clinic);
      const best = selectBestDM(dms);
      if (best) {
        const upd: any = { managerName: `${best.firstName} ${best.lastName}`.trim(), managerEmail: best.email };
        if (best.role === 'owner' || best.role === 'medical_director') { upd.ownerName = upd.managerName; upd.ownerEmail = best.email; }
        updateClinic(clinic.id, upd);
      }
      const updated = clinics.find(c => c.id === clinic.id) || clinic;
      const trends = keywordTrends.filter(t => t.location.id === clinic.marketZone.id);
      const shell: CRMContact = {
        id: `contact-${clinic.id}-${Date.now()}`, clinic: updated,
        decisionMaker: best || dms[0], status: best || dms.length > 0 ? 'ready_to_call' : 'researching',
        priority: 'medium', score: 0, tags: clinic.services, notes: '',
        keywordMatches: trends.slice(0, 5), activities: [], createdAt: new Date(), updatedAt: new Date(),
      };
      const { score, priority } = computeLeadScore(shell);
      addContact({ ...shell, score, priority });
      toast.success('Added to CRM', { id: 'adding' });
    } catch { toast.error('Failed to add to CRM', { id: 'adding' }); }
  };

  const handleEnrichClinic = async (clinic: Clinic) => {
    toast.loading('Finding decision makers...', { id: `enrich-${clinic.id}` });
    try {
      const dms = await enrichmentService.findDecisionMakers(clinic);
      if (!dms.length) { toast('No decision makers found', { id: `enrich-${clinic.id}` }); return; }
      
      // Store ALL decision makers with emails as enrichedContacts
      const enrichedContacts = dms
        .filter((d: any) => d.email || d.phone)
        .map((d: any) => ({
          name: `${d.firstName} ${d.lastName}`.trim(),
          title: d.title || '',
          role: d.role || 'clinic_manager',
          email: d.email || undefined,
          phone: d.phone || undefined,
          linkedInUrl: d.linkedInUrl || undefined,
          confidence: d.confidence || 0,
          source: d.source || 'unknown',
          enrichedAt: new Date().toISOString(),
          emailVerified: d.emailVerified || false,
          emailVerificationStatus: d.emailVerificationStatus || 'unknown',
        }));

      const best = selectBestDM(dms)!;
      const upd: any = {
        managerName: `${best.firstName} ${best.lastName}`.trim(),
        managerEmail: best.email,
        enrichedContacts,
      };
      if (best.role === 'owner' || best.role === 'medical_director') {
        upd.ownerName = upd.managerName;
        upd.ownerEmail = best.email;
      }
      if (best.phone && !clinic.phone) upd.phone = best.phone;
      
      // Find a second DM for owner/director slot
      const second = dms.find((d: any) => d.id !== best.id && d.email);
      if (second && (!upd.ownerName || upd.ownerName === upd.managerName)) {
        upd.ownerName = `${second.firstName} ${second.lastName}`.trim();
        upd.ownerEmail = second.email;
      }
      
      updateClinic(clinic.id, upd);
      // Also update the selectedClinic if it's the same one (for drawer refresh)
      if (selectedClinic?.id === clinic.id) {
        setSelectedClinic({ ...clinic, ...upd });
      }
      const emailCount = enrichedContacts.filter((c: any) => c.email).length;
      toast.success(`Found ${enrichedContacts.length} contacts (${emailCount} emails)`, { id: `enrich-${clinic.id}` });
    } catch { toast.error('Enrichment failed', { id: `enrich-${clinic.id}` }); }
  };

  const handleBulkSaveAll = async () => {
    const toSave = filteredClinics.filter(c => !isInCRM(c));
    if (!toSave.length) { toast('All clinics already in CRM'); return; }
    setIsBulkSaving(true);
    toast.loading(`Saving ${toSave.length} clinics...`, { id: 'bulk' });
    const newContacts: CRMContact[] = [];
    for (let i = 0; i < toSave.length; i++) {
      const clinic = toSave[i];
      toast.loading(`${i + 1}/${toSave.length}: ${clinic.name}`, { id: 'bulk' });
      let best: any = null;
      try {
        const dms = await enrichmentService.findDecisionMakers(clinic);
        best = selectBestDM(dms);
        if (best) {
          const enrichedContacts = dms
            .filter((d: any) => d.email || d.phone)
            .map((d: any) => ({
              name: `${d.firstName} ${d.lastName}`.trim(),
              title: d.title || '',
              role: d.role || 'clinic_manager',
              email: d.email || undefined,
              phone: d.phone || undefined,
              linkedInUrl: d.linkedInUrl || undefined,
              confidence: d.confidence || 0,
              source: d.source || 'unknown',
              enrichedAt: new Date().toISOString(),
            }));
          const upd: any = { managerName: `${best.firstName} ${best.lastName}`.trim(), managerEmail: best.email, enrichedContacts };
          if (best.role === 'owner' || best.role === 'medical_director') { upd.ownerName = upd.managerName; upd.ownerEmail = best.email; }
          updateClinic(clinic.id, upd);
        }
      } catch {}
      const trends = keywordTrends.filter(t => t.location.id === clinic.marketZone.id);
      const snap = { ...clinic, ...(best ? { managerName: `${best.firstName} ${best.lastName}`.trim(), managerEmail: best.email } : {}) };
      const shell: CRMContact = {
        id: `contact-${clinic.id}-${Date.now()}-${i}`, clinic: snap,
        decisionMaker: best, status: best ? 'ready_to_call' : 'researching',
        priority: 'medium', score: 0, tags: clinic.services, notes: '',
        keywordMatches: trends.slice(0, 5), activities: [], createdAt: new Date(), updatedAt: new Date(),
      };
      const { score, priority } = computeLeadScore(shell);
      newContacts.push({ ...shell, score, priority });
    }
    if (newContacts.length > 0) addContacts(newContacts);
    setIsBulkSaving(false);
    toast.success(`Saved ${newContacts.length} clinics to CRM`, { id: 'bulk' });
  };

  const handleRemoveClinic = (id: string) => {
    const updated = clinics.filter(c => c.id !== id);
    useAppStore.setState({ clinics: updated });
    if (selectedClinic?.id === id) setSelectedClinic(null);
    toast.success('Clinic removed');
  };

  // ─── Sorting ───

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === 'desc' ? <ChevronDown className="w-3 h-3 inline ml-0.5" /> : <ChevronUp className="w-3 h-3 inline ml-0.5" />;
  };

  // ─── Filtered + sorted clinics ───

  const filteredClinics = useMemo(() => {
    let list = selectedMarket ? clinics.filter(c => c.marketZone.id === selectedMarket.id) : clinics;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.address.city.toLowerCase().includes(q) || c.phone?.includes(q) || c.services.some(s => s.toLowerCase().includes(q)));
    }
    if (typeFilter) list = list.filter(c => c.type === typeFilter);
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'rating': cmp = (a.rating || 0) - (b.rating || 0); break;
        case 'reviewCount': cmp = (a.reviewCount || 0) - (b.reviewCount || 0); break;
        case 'type': cmp = a.type.localeCompare(b.type); break;
        case 'market': cmp = a.marketZone.city.localeCompare(b.marketZone.city); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [clinics, selectedMarket, searchQuery, typeFilter, sortKey, sortDir]);

  // ─── Stats ───

  const notInCRM = filteredClinics.filter(c => !isInCRM(c)).length;
  const withPhone = filteredClinics.filter(c => !!c.phone).length;
  const withWebsite = filteredClinics.filter(c => !!c.website).length;
  const avgRating = filteredClinics.length > 0 ? (filteredClinics.reduce((s, c) => s + (c.rating || 0), 0) / filteredClinics.filter(c => c.rating).length) : 0;
  const regionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of clinics) { map.set(c.marketZone.city, (map.get(c.marketZone.city) || 0) + 1); }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [clinics]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Clinic Discovery</h1>
          <p className="text-slate-500 text-sm">Find and manage men's health clinics across affluent markets</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => {
            const rows = filteredClinics.map(c => ({
              name: c.name,
              type: getTypeLabel(c.type),
              street: c.address.street,
              city: c.address.city,
              state: c.address.state,
              zip: c.address.zip,
              phone: c.phone || '',
              email: c.email || '',
              website: c.website || '',
              rating: c.rating ?? '',
              reviews: c.reviewCount ?? '',
              services: c.services.join('; '),
              manager_name: c.managerName || '',
              manager_email: c.managerEmail || '',
              owner_name: c.ownerName || '',
              owner_email: c.ownerEmail || '',
              market: `${c.marketZone.city}, ${c.marketZone.state}`,
              affluence_score: c.marketZone.affluenceScore,
              median_income: c.marketZone.medianIncome,
              in_crm: isInCRM(c) ? 'Yes' : 'No',
              google_place_id: c.googlePlaceId || '',
            }));
            const headers = Object.keys(rows[0] || {});
            const csv = [headers.join(','), ...rows.map(r => headers.map(h => {
              const v = String((r as any)[h] || '');
              return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
            }).join(','))].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `novalyte-clinics-${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(`Exported ${rows.length} clinics to CSV`);
          }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-novalyte-500/20 text-novalyte-300 text-xs font-medium hover:bg-novalyte-500/30 transition-colors border border-novalyte-500/20">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 border border-white/[0.06]">
            <button onClick={() => setViewMode('table')} className={cn('p-2 rounded-md transition-colors', viewMode === 'table' ? 'bg-novalyte-500/20 text-novalyte-400' : 'text-slate-500 hover:text-slate-300')}>
              <LayoutList className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('grid')} className={cn('p-2 rounded-md transition-colors', viewMode === 'grid' ? 'bg-novalyte-500/20 text-novalyte-400' : 'text-slate-500 hover:text-slate-300')}>
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="glass-card p-3"><p className="text-[10px] text-slate-500 uppercase tracking-wider">Discovered</p><p className="text-xl font-bold text-white">{clinics.length}</p></div>
        <div className="glass-card p-3"><p className="text-[10px] text-slate-500 uppercase tracking-wider">Not in CRM</p><p className="text-xl font-bold text-amber-400">{notInCRM}</p></div>
        <div className="glass-card p-3"><p className="text-[10px] text-slate-500 uppercase tracking-wider">With Phone</p><p className="text-xl font-bold text-emerald-400">{withPhone}</p></div>
        <div className="glass-card p-3"><p className="text-[10px] text-slate-500 uppercase tracking-wider">With Website</p><p className="text-xl font-bold text-novalyte-400">{withWebsite}</p></div>
        <div className="glass-card p-3"><p className="text-[10px] text-slate-500 uppercase tracking-wider">Avg Rating</p><p className="text-xl font-bold text-white">{avgRating ? avgRating.toFixed(1) : '—'} <Star className="w-3.5 h-3.5 inline text-yellow-400 fill-yellow-400" /></p></div>
      </div>

      {/* Region pills */}
      {regionCounts.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {regionCounts.map(([city, count]) => (
            <button key={city} onClick={() => { const m = markets.find(mk => mk.city === city); if (m) selectMarket(m); }}
              className={cn('px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
                selectedMarket?.city === city ? 'bg-novalyte-500/20 text-novalyte-300 border-novalyte-500/30' : 'bg-white/5 text-slate-400 border-white/[0.06] hover:border-novalyte-500/30'
              )}>
              {city} <span className="ml-1 opacity-60">({count})</span>
            </button>
          ))}
          {selectedMarket && (
            <button onClick={() => selectMarket(null)} className="px-3 py-1.5 rounded-full text-xs font-medium text-red-400 border border-red-500/20 hover:bg-red-500/10">
              Clear ×
            </button>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="glass-card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="text" placeholder="Search clinics..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="input pl-9 w-full" />
            </div>
          </div>
          <select value={selectedMarket?.id || ''} onChange={e => selectMarket(markets.find(m => m.id === e.target.value) || null)} className="input min-w-[180px]">
            <option value="">All Markets</option>
            {markets.map(m => <option key={m.id} value={m.id}>{m.city}, {m.state}</option>)}
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input min-w-[140px]">
            <option value="">All Types</option>
            {(['mens_health_clinic', 'hormone_clinic', 'urology_practice', 'med_spa', 'anti_aging_clinic', 'wellness_center', 'aesthetic_clinic'] as Clinic['type'][]).map(t => (
              <option key={t} value={t}>{getTypeLabel(t)}</option>
            ))}
          </select>
          <button onClick={handleDiscoverClinics} disabled={isDiscovering || !selectedMarket} className="btn btn-primary">
            {isDiscovering ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />} Discover
          </button>
          <button onClick={handleDiscoverAllMarkets} disabled={isDiscovering} className="btn bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/30">
            <Radar className="w-4 h-4 mr-2" /> All Markets
          </button>
          {notInCRM > 0 && (
            <button onClick={handleBulkSaveAll} disabled={isBulkSaving} className="btn bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/30">
              {isBulkSaving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />} Save All ({notInCRM})
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      {isDiscovering && discoveryProgress && (
        <div className="glass-card p-4 mb-6 border-l-4 border-novalyte-500">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-novalyte-400 animate-spin shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-200">{discoveryProgress}</p>
              {discoveryStats && <p className="text-xs text-slate-500 mt-1">{discoveryStats.marketsScanned}/{markets.length} markets · {discoveryStats.totalFound} found</p>}
            </div>
          </div>
          {discoveryStats && (
            <div className="mt-2 w-full bg-white/5 rounded-full h-1.5">
              <div className="bg-novalyte-500 h-1.5 rounded-full transition-all" style={{ width: `${Math.round((discoveryStats.marketsScanned / markets.length) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {filteredClinics.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <Building2 className="w-12 h-12 text-slate-700 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-400 mb-2">No clinics discovered yet</h3>
          <p className="text-sm text-slate-600 mb-6 max-w-md mx-auto">Select a market and hit Discover, or scan all markets at once.</p>
          <button onClick={handleDiscoverAllMarkets} disabled={isDiscovering} className="btn btn-primary mx-auto">
            <Radar className="w-4 h-4 mr-2" /> Discover All Markets
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /* ─── Table View ─── */
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.03] border-b border-white/[0.06] text-left">
                  <th className="px-4 py-3 font-semibold text-slate-400 cursor-pointer hover:text-slate-200 select-none" onClick={() => toggleSort('name')}>
                    Name <SortIcon col="name" />
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-400 cursor-pointer hover:text-slate-200 select-none" onClick={() => toggleSort('market')}>
                    Market <SortIcon col="market" />
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-400 cursor-pointer hover:text-slate-200 select-none" onClick={() => toggleSort('type')}>
                    Type <SortIcon col="type" />
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-400 cursor-pointer hover:text-slate-200 select-none" onClick={() => toggleSort('rating')}>
                    Rating <SortIcon col="rating" />
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-400 cursor-pointer hover:text-slate-200 select-none" onClick={() => toggleSort('reviewCount')}>
                    Reviews <SortIcon col="reviewCount" />
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-400">Phone</th>
                  <th className="px-4 py-3 font-semibold text-slate-400">Website</th>
                  <th className="px-4 py-3 font-semibold text-slate-400">Status</th>
                  <th className="px-4 py-3 font-semibold text-slate-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredClinics.map(clinic => (
                  <tr
                    key={clinic.id}
                    className={cn('hover:bg-white/[0.03] cursor-pointer transition-colors', selectedClinic?.id === clinic.id && 'bg-novalyte-500/10')}
                    onClick={() => setSelectedClinic(selectedClinic?.id === clinic.id ? null : clinic)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-200 truncate max-w-[220px]">{clinic.name}</div>
                      <div className="text-xs text-slate-500 truncate">{clinic.address.street}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center text-slate-400 text-xs">
                        <MapPin className="w-3 h-3 mr-1 shrink-0" />{clinic.marketZone.city}, {clinic.marketZone.state}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge badge-info text-[11px]">{getTypeLabel(clinic.type)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {clinic.rating ? (
                        <span className="flex items-center gap-1 text-slate-300">
                          <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" /> {clinic.rating.toFixed(1)}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{clinic.reviewCount ?? '—'}</td>
                    <td className="px-4 py-3">
                      {clinic.phone ? (
                        <a href={`tel:${clinic.phone}`} onClick={e => e.stopPropagation()} className="text-novalyte-400 hover:underline text-xs flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {clinic.phone}
                        </a>
                      ) : <span className="text-slate-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {clinic.website ? (
                        <a href={clinic.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-blue-400 hover:underline text-xs flex items-center gap-1">
                          <Globe className="w-3 h-3" /> Visit
                        </a>
                      ) : <span className="text-slate-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {isInCRM(clinic) ? (
                        <span className="badge badge-success text-[11px] flex items-center gap-1 w-fit"><CheckCircle2 className="w-3 h-3" /> In CRM</span>
                      ) : (
                        <span className="badge text-[11px] bg-white/5 text-slate-500">New</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                        {!isInCRM(clinic) && (
                          <button onClick={() => handleAddToCRM(clinic)} title="Add to CRM" className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-emerald-400">
                            <Plus className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => handleEnrichClinic(clinic)} title="Find Decision Maker" className="p-1.5 rounded-lg hover:bg-novalyte-500/10 text-novalyte-400">
                          <UserSearch className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleRemoveClinic(clinic.id)} title="Remove" className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-white/[0.02] border-t border-white/[0.06] text-xs text-slate-500">
            Showing {filteredClinics.length} clinic{filteredClinics.length !== 1 ? 's' : ''}
            {selectedMarket ? ` in ${selectedMarket.city}` : ' across all markets'}
          </div>
        </div>
      ) : (
        /* ─── Grid View ─── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredClinics.map(clinic => (
            <div
              key={clinic.id}
              onClick={() => setSelectedClinic(selectedClinic?.id === clinic.id ? null : clinic)}
              className={cn('glass-card p-5 cursor-pointer hover:border-white/[0.12] transition-all', selectedClinic?.id === clinic.id && 'ring-2 ring-novalyte-400')}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-200 truncate">{clinic.name}</h3>
                  <p className="text-xs text-slate-500 flex items-center mt-1">
                    <MapPin className="w-3 h-3 mr-1 shrink-0" />{clinic.address.city}, {clinic.address.state}
                  </p>
                </div>
                {isInCRM(clinic) ? (
                  <span className="badge badge-success text-[10px] shrink-0"><CheckCircle2 className="w-3 h-3 mr-0.5" /> CRM</span>
                ) : (
                  <span className="badge text-[10px] bg-white/5 text-slate-500 shrink-0">New</span>
                )}
              </div>
              <div className="flex items-center gap-3 mb-3 text-xs text-slate-500">
                <span className="badge badge-info text-[10px]">{getTypeLabel(clinic.type)}</span>
                {clinic.rating && (
                  <span className="flex items-center gap-0.5">
                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" /> {clinic.rating.toFixed(1)}
                    {clinic.reviewCount && <span className="text-slate-600 ml-0.5">({clinic.reviewCount})</span>}
                  </span>
                )}
              </div>
              {clinic.services.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {clinic.services.slice(0, 4).map(s => (
                    <span key={s} className="px-2 py-0.5 bg-white/5 text-slate-400 rounded text-[10px]">{s}</span>
                  ))}
                  {clinic.services.length > 4 && <span className="text-[10px] text-slate-600">+{clinic.services.length - 4}</span>}
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                {clinic.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {clinic.phone}</span>}
                {clinic.website && <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> Website</span>}
              </div>
              <div className="flex items-center gap-1 pt-3 border-t border-white/[0.06]" onClick={e => e.stopPropagation()}>
                {!isInCRM(clinic) && (
                  <button onClick={() => handleAddToCRM(clinic)} className="btn btn-primary text-xs py-1.5 flex-1">
                    <Plus className="w-3 h-3 mr-1" /> Add to CRM
                  </button>
                )}
                <button onClick={() => handleEnrichClinic(clinic)} className="btn btn-secondary text-xs py-1.5" title="Find Decision Maker">
                  <UserSearch className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleRemoveClinic(clinic.id)} className="btn text-xs py-1.5 text-red-400 hover:bg-red-500/10 border border-red-500/20" title="Remove">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Detail Drawer ─── */}
      {selectedClinic && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedClinic(null)} />
          <div className="relative w-full sm:w-[440px] bg-black shadow-2xl border-l border-white/[0.06] flex flex-col">
          {/* Drawer header */}
          <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg text-white truncate">{selectedClinic.name}</h3>
              <p className="text-sm text-slate-400 flex items-center mt-1">
                <MapPin className="w-3.5 h-3.5 mr-1 shrink-0" />
                {selectedClinic.address.street ? `${selectedClinic.address.street}, ` : ''}{selectedClinic.address.city}, {selectedClinic.address.state} {selectedClinic.address.zip}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="badge badge-info text-[11px]">{getTypeLabel(selectedClinic.type)}</span>
                {isInCRM(selectedClinic) && <span className="badge badge-success text-[11px]"><CheckCircle2 className="w-3 h-3 mr-0.5" /> In CRM</span>}
              </div>
            </div>
            <button onClick={() => setSelectedClinic(null)} className="p-1.5 rounded-lg hover:bg-white/5 shrink-0">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          {/* Drawer body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
            {/* Rating & Reviews */}
            {(selectedClinic.rating || selectedClinic.reviewCount) && (
              <div className="flex items-center gap-4">
                {selectedClinic.rating && (
                  <div className="flex items-center gap-1.5">
                    <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                    <span className="text-xl font-bold">{selectedClinic.rating.toFixed(1)}</span>
                  </div>
                )}
                {selectedClinic.reviewCount && (
                  <span className="text-sm text-slate-500">{selectedClinic.reviewCount} reviews</span>
                )}
              </div>
            )}

            {/* Contact Info */}
            <div className="bg-white/[0.03] rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-semibold text-slate-300">Contact Information</h4>
              {selectedClinic.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Phone</span>
                  <a href={`tel:${selectedClinic.phone}`} className="text-sm font-medium text-novalyte-400 hover:underline flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" /> {selectedClinic.phone}
                  </a>
                </div>
              )}
              {selectedClinic.website && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Website</span>
                  <a href={selectedClinic.website} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-400 hover:underline flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> Visit Site <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              {selectedClinic.email && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Email</span>
                  <span className="text-sm font-medium text-slate-300">{selectedClinic.email}</span>
                </div>
              )}
            </div>

            {/* Decision Makers */}
            <div className="bg-white/[0.03] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-300">Decision Makers</h4>
                <button onClick={() => handleEnrichClinic(selectedClinic)} className="text-xs text-novalyte-400 hover:underline flex items-center gap-1">
                  <UserSearch className="w-3 h-3" /> {selectedClinic.enrichedContacts?.length ? 'Re-enrich' : 'Find DM'}
                </button>
              </div>
              {selectedClinic.enrichedContacts && selectedClinic.enrichedContacts.length > 0 ? (
                <div className="space-y-2.5">
                  {selectedClinic.enrichedContacts.map((ec: any, idx: number) => (
                    <div key={idx} className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-white">{ec.name}</span>
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded',
                          ec.confidence >= 90 ? 'bg-emerald-500/15 text-emerald-400' :
                          ec.confidence >= 70 ? 'bg-cyan-500/15 text-cyan-400' :
                          ec.confidence >= 50 ? 'bg-amber-500/15 text-amber-400' :
                          'bg-slate-500/15 text-slate-400'
                        )}>{ec.confidence}%</span>
                      </div>
                      {ec.title && <p className="text-[10px] text-slate-500">{ec.title}</p>}
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                        <span className={cn('px-1.5 py-0.5 rounded capitalize',
                          ec.role === 'owner' ? 'bg-purple-500/10 text-purple-400' :
                          ec.role === 'medical_director' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-white/5 text-slate-400'
                        )}>{(ec.role || '').replace(/_/g, ' ')}</span>
                        <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-500">{ec.source}</span>
                      </div>
                      {ec.email && (
                        <div className="flex items-center gap-1.5">
                          <a href={`mailto:${ec.email}`} className="flex items-center gap-1 text-xs text-novalyte-400 hover:underline">
                            <Mail className="w-3 h-3" /> {ec.email}
                          </a>
                          {ec.emailVerified && ec.emailVerificationStatus === 'valid' && <span className="text-[8px] px-1 py-0.5 bg-emerald-500/15 text-emerald-400 rounded font-medium">✓ Verified</span>}
                          {ec.emailVerified && ec.emailVerificationStatus === 'risky' && <span className="text-[8px] px-1 py-0.5 bg-amber-500/15 text-amber-400 rounded font-medium">Risky</span>}
                          {ec.emailVerified && ec.emailVerificationStatus === 'invalid' && <span className="text-[8px] px-1 py-0.5 bg-red-500/15 text-red-400 rounded font-medium">Invalid</span>}
                        </div>
                      )}
                      {ec.phone && (
                        <a href={`tel:${ec.phone}`} className="flex items-center gap-1.5 text-xs text-emerald-400 hover:underline">
                          <Phone className="w-3 h-3" /> {ec.phone}
                        </a>
                      )}
                      {ec.linkedInUrl && (
                        <a href={ec.linkedInUrl} target="_blank" rel="noopener" className="flex items-center gap-1.5 text-xs text-blue-400 hover:underline">
                          <ExternalLink className="w-3 h-3" /> LinkedIn
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : selectedClinic.managerName ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Name</span>
                    <span className="text-sm font-medium text-slate-300">{selectedClinic.managerName}</span>
                  </div>
                  {selectedClinic.managerEmail && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500">Email</span>
                      <a href={`mailto:${selectedClinic.managerEmail}`} className="text-sm font-medium text-novalyte-400 hover:underline">{selectedClinic.managerEmail}</a>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-600 italic">No decision makers found yet. Click "Find DM" to enrich.</p>
              )}
            </div>

            {/* Services */}
            {selectedClinic.services.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Services</h4>
                <div className="flex flex-wrap gap-1.5">
                  {selectedClinic.services.map(s => (
                    <span key={s} className="px-2.5 py-1 bg-novalyte-500/10 text-novalyte-300 rounded-lg text-xs font-medium">{s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Market Info */}
            <div className="bg-white/[0.03] rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-300 mb-3">Market Details</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Metro Area</span><span className="font-medium text-slate-300">{selectedClinic.marketZone.metropolitanArea}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Median Income</span><span className="font-medium text-slate-300">${selectedClinic.marketZone.medianIncome.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Population</span><span className="font-medium text-slate-300">{selectedClinic.marketZone.population.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Affluence Score</span><span className="font-medium text-slate-300">{selectedClinic.marketZone.affluenceScore}/10</span></div>
              </div>
            </div>

            {/* Google Place ID */}
            {selectedClinic.googlePlaceId && (
              <div className="text-xs text-slate-600">
                Place ID: <span className="font-mono">{selectedClinic.googlePlaceId}</span>
              </div>
            )}
          </div>

          {/* Drawer footer actions */}
          <div className="p-4 sm:p-5 border-t border-white/[0.06] space-y-2">
            {!isInCRM(selectedClinic) && (
              <button onClick={() => handleAddToCRM(selectedClinic)} className="btn btn-primary w-full">
                <Plus className="w-4 h-4 mr-2" /> Add to CRM
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {selectedClinic.website && (
                <a href={selectedClinic.website} target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-sm text-center">
                  <Globe className="w-4 h-4 mr-1" /> Website
                </a>
              )}
              {selectedClinic.phone && (
                <a href={`tel:${selectedClinic.phone}`} className="btn btn-secondary text-sm text-center">
                  <Phone className="w-4 h-4 mr-1" /> Call
                </a>
              )}
            </div>
            <button onClick={() => { handleRemoveClinic(selectedClinic.id); }} className="btn w-full text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20">
              <Trash2 className="w-4 h-4 mr-1" /> Remove Clinic
            </button>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}

export default ClinicDiscovery;
