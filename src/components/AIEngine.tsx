import { useState } from 'react';
import { 
  Brain, Database, TrendingUp, CheckCircle, AlertCircle, Loader2, Download,
  Activity, Target, Cpu, Network, Layers, Gauge,
  ArrowRight, Play, Settings, Calendar, Clock,
  ChevronUp, Eye, EyeOff, Phone, Mail, X
} from 'lucide-react';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';

type PipelineStep = 'idle' | 'syncing' | 'training' | 'scoring' | 'complete' | 'error';

interface PipelineStatus {
  step: PipelineStep;
  message: string;
  progress: number;
  clinicsSynced?: number;
  leadsSynced?: number;
  modelAccuracy?: number;
  hotProspects?: number;
  warmProspects?: number;
  coldProspects?: number;
  syncDuration?: number;
  trainDuration?: number;
  scoreDuration?: number;
}

interface PipelineConfig {
  autoRetrain: boolean;
  minAccuracy: number;
  scoreThreshold: number;
  excludeRecentlyContacted: boolean;
  daysSinceContact: number;
  includeMarkets: string[];
  minAffluence: number;
}

export default function AIEngine() {
  const [status, setStatus] = useState<PipelineStatus>({ step: 'idle', message: 'Ready to run intelligence pipeline', progress: 0 });
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [topProspects, setTopProspects] = useState<any[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [showMetrics] = useState(true);
  const [showDataFlow, setShowDataFlow] = useState(true);
  const [animateFlow, setAnimateFlow] = useState(false);
  const [config, setConfig] = useState<PipelineConfig>({
    autoRetrain: true,
    minAccuracy: 0.70,
    scoreThreshold: 0.40,
    excludeRecentlyContacted: true,
    daysSinceContact: 30,
    includeMarkets: [],
    minAffluence: 5,
  });
  const [pipelineHistory, setPipelineHistory] = useState<any[]>([]);
  const [selectedProspect, setSelectedProspect] = useState<any>(null);

  const runPipeline = async () => {
    setAnimateFlow(true);
    const startTime = Date.now();
    setStatus({ step: 'syncing', message: 'Syncing data from Supabase to BigQuery...', progress: 10 });
    
    try {
      // Step 1: Sync data
      const syncStart = Date.now();
      const syncRes = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-sync', { method: 'POST' });
      if (!syncRes.ok) throw new Error('Sync failed');
      const syncData = await syncRes.json();
      const syncDuration = Math.round((Date.now() - syncStart) / 1000);
      
      setStatus({
        step: 'training',
        message: 'Training propensity model with BigQuery ML...',
        progress: 40,
        clinicsSynced: syncData.clinicsSynced,
        leadsSynced: syncData.leadsSynced,
        syncDuration,
      });
      
      // Step 2: Train model
      const trainStart = Date.now();
      const trainRes = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-train', { method: 'POST' });
      if (!trainRes.ok) throw new Error('Training failed');
      const trainData = await trainRes.json();
      const trainDuration = Math.round((Date.now() - trainStart) / 1000);
      
      setStatus({
        step: 'scoring',
        message: 'Scoring all clinics...',
        progress: 70,
        clinicsSynced: syncData.clinicsSynced,
        leadsSynced: syncData.leadsSynced,
        modelAccuracy: trainData.accuracy,
        syncDuration,
        trainDuration,
      });
      
      // Step 3: Score clinics
      const scoreStart = Date.now();
      const scoreRes = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-score', { method: 'POST' });
      if (!scoreRes.ok) throw new Error('Scoring failed');
      const scoreData = await scoreRes.json();
      const scoreDuration = Math.round((Date.now() - scoreStart) / 1000);
      const totalDuration = Math.round((Date.now() - startTime) / 1000);
      
      setStatus({
        step: 'complete',
        message: 'Pipeline complete! Clinics scored and ready.',
        progress: 100,
        clinicsSynced: syncData.clinicsSynced,
        leadsSynced: syncData.leadsSynced,
        modelAccuracy: trainData.accuracy,
        hotProspects: scoreData.hotProspects,
        warmProspects: scoreData.warmProspects,
        coldProspects: scoreData.coldProspects,
        syncDuration,
        trainDuration,
        scoreDuration,
      });
      
      setTopProspects(scoreData.topProspects || []);
      const runTime = new Date();
      setLastRun(runTime);
      
      // Add to history
      setPipelineHistory(prev => [{
        timestamp: runTime,
        duration: totalDuration,
        clinics: syncData.clinicsSynced,
        leads: syncData.leadsSynced,
        accuracy: trainData.accuracy,
        hotProspects: scoreData.hotProspects,
        status: 'success',
      }, ...prev.slice(0, 9)]);
      
      toast.success(`Pipeline complete in ${totalDuration}s!`);
      setTimeout(() => setAnimateFlow(false), 2000);
    } catch (err: any) {
      setStatus({ step: 'error', message: err.message || 'Pipeline failed', progress: 0 });
      toast.error('Pipeline failed: ' + err.message);
      setAnimateFlow(false);
      
      setPipelineHistory(prev => [{
        timestamp: new Date(),
        duration: Math.round((Date.now() - startTime) / 1000),
        status: 'error',
        error: err.message,
      }, ...prev.slice(0, 9)]);
    }
  };

  const exportProspects = () => {
    if (topProspects.length === 0) {
      toast.error('No prospects to export. Run the pipeline first.');
      return;
    }
    
    const csv = [
      'name,city,state,phone,email,propensity_score,propensity_tier,affluence_score,services',
      ...topProspects.map(p => [
        p.name, p.city, p.state, p.phone || '', p.email || '',
        p.propensity_score, p.propensity_tier, p.affluence_score,
        (p.services || []).join('; ')
      ].map(v => String(v).includes(',') ? `"${v}"` : v).join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novalyte-hot-prospects-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${topProspects.length} prospects`);
  };

  return (
    <div className="min-h-screen bg-black p-4 md:p-6 space-y-4">
      {/* Hero Header with Animated Background */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-novalyte-900/40 via-black to-novalyte-900/20 border border-novalyte-500/20 p-8">
        {/* Animated grid background */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute inset-0" style={{
            backgroundImage: 'linear-gradient(rgba(6, 182, 212, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(6, 182, 212, 0.1) 1px, transparent 1px)',
            backgroundSize: '50px 50px',
          }} />
        </div>
        
        {/* Floating orbs */}
        <div className="absolute top-10 right-20 w-32 h-32 bg-novalyte-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-10 left-20 w-40 h-40 bg-novalyte-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        
        <div className="relative z-10">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl bg-[#06B6D4] flex items-center justify-center shadow-2xl shadow-novalyte-500/50">
                    <Brain className="w-7 h-7 text-[#000000]" />
                  </div>
                  {status.step !== 'idle' && status.step !== 'complete' && status.step !== 'error' && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full animate-ping" />
                  )}
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white tracking-tight">AI Intelligence Engine</h1>
                  <p className="text-sm text-slate-400 mt-0.5">BigQuery ML + Vertex AI Propensity Scoring</p>
                </div>
              </div>
              {lastRun && (
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-3">
                  <Clock className="w-3.5 h-3.5" />
                  Last run: {lastRun.toLocaleString()} 
                  {status.syncDuration && <span className="ml-2">• {status.syncDuration + (status.trainDuration || 0) + (status.scoreDuration || 0)}s total</span>}
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowConfig(!showConfig)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-medium transition-all"
              >
                <Settings className="w-4 h-4" />
                Configure
              </button>
              <button
                onClick={runPipeline}
                disabled={status.step !== 'idle' && status.step !== 'complete' && status.step !== 'error'}
                className={cn(
                  'flex items-center gap-2.5 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg',
                  status.step === 'idle' || status.step === 'complete' || status.step === 'error'
                    ? 'bg-[#06B6D4] text-[#000000] hover:bg-[#22D3EE] hover:scale-105'
                    : 'bg-white/5 text-slate-500 cursor-not-allowed'
                )}
              >
                {status.step !== 'idle' && status.step !== 'complete' && status.step !== 'error' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Running...</>
                ) : (
                  <><Play className="w-4 h-4" /> Run Pipeline</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Panel */}
      {showConfig && (
        <div className="glass-card p-6 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              <Settings className="w-5 h-5 text-novalyte-400" />
              Pipeline Configuration
            </h3>
            <button onClick={() => setShowConfig(false)} className="text-slate-500 hover:text-slate-300">
              <ChevronUp className="w-5 h-5" />
            </button>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                  <Target className="w-4 h-4 text-novalyte-400" />
                  Score Threshold
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={config.scoreThreshold * 100}
                  onChange={e => setConfig({ ...config, scoreThreshold: parseInt(e.target.value) / 100 })}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>0%</span>
                  <span className="text-novalyte-400 font-semibold">{(config.scoreThreshold * 100).toFixed(0)}%</span>
                  <span>100%</span>
                </div>
              </div>
              
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                  <Gauge className="w-4 h-4 text-emerald-400" />
                  Minimum Model Accuracy
                </label>
                <input
                  type="range"
                  min="50"
                  max="95"
                  value={config.minAccuracy * 100}
                  onChange={e => setConfig({ ...config, minAccuracy: parseInt(e.target.value) / 100 })}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>50%</span>
                  <span className="text-emerald-400 font-semibold">{(config.minAccuracy * 100).toFixed(0)}%</span>
                  <span>95%</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.excludeRecentlyContacted}
                  onChange={e => setConfig({ ...config, excludeRecentlyContacted: e.target.checked })}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-novalyte-500"
                />
                <span className="text-sm text-slate-300">Exclude recently contacted clinics</span>
              </label>
              
              {config.excludeRecentlyContacted && (
                <div className="ml-7">
                  <label className="text-xs text-slate-500 mb-2 block">Days since last contact</label>
                  <input
                    type="number"
                    value={config.daysSinceContact}
                    onChange={e => setConfig({ ...config, daysSinceContact: parseInt(e.target.value) })}
                    className="w-24 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-sm"
                  />
                </div>
              )}
              
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoRetrain}
                  onChange={e => setConfig({ ...config, autoRetrain: e.target.checked })}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-novalyte-500"
                />
                <span className="text-sm text-slate-300">Auto-retrain if accuracy drops</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Data Flow Visualization */}
      {showDataFlow && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              <Network className="w-5 h-5 text-novalyte-400" />
              Pipeline Architecture
            </h3>
            <button onClick={() => setShowDataFlow(!showDataFlow)} className="text-slate-500 hover:text-slate-300 text-xs">
              {showDataFlow ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          
          <div className="relative">
            {/* Flow diagram */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Step 1: Supabase */}
              <div className={cn(
                'flex-1 min-w-[200px] p-4 rounded-xl border-2 transition-all duration-500',
                status.step === 'syncing' && animateFlow
                  ? 'border-novalyte-500 bg-novalyte-500/10 shadow-lg shadow-novalyte-500/50'
                  : 'border-white/10 bg-white/5'
              )}>
                <div className="flex items-center gap-3 mb-2">
                  <Database className={cn('w-6 h-6', status.step === 'syncing' && animateFlow ? 'text-novalyte-400 animate-pulse' : 'text-slate-400')} />
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Supabase</h4>
                    <p className="text-xs text-slate-500">Source Data</p>
                  </div>
                </div>
                {status.clinicsSynced !== undefined && (
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Clinics</span>
                      <span className="text-novalyte-400 font-semibold">{status.clinicsSynced}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Leads</span>
                      <span className="text-novalyte-400 font-semibold">{status.leadsSynced}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Arrow */}
              <ArrowRight className={cn('w-6 h-6 shrink-0', animateFlow && status.step === 'syncing' ? 'text-novalyte-400 animate-pulse' : 'text-slate-600')} />

              {/* Step 2: BigQuery */}
              <div className={cn(
                'flex-1 min-w-[200px] p-4 rounded-xl border-2 transition-all duration-500',
                (status.step === 'syncing' || status.step === 'training') && animateFlow
                  ? 'border-novalyte-500 bg-novalyte-500/10 shadow-lg shadow-novalyte-500/50'
                  : 'border-white/10 bg-white/5'
              )}>
                <div className="flex items-center gap-3 mb-2">
                  <Layers className={cn('w-6 h-6', (status.step === 'syncing' || status.step === 'training') && animateFlow ? 'text-novalyte-400 animate-pulse' : 'text-slate-400')} />
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">BigQuery</h4>
                    <p className="text-xs text-slate-500">Data Warehouse</p>
                  </div>
                </div>
                {status.syncDuration !== undefined && (
                  <div className="text-xs text-slate-500">
                    Synced in <span className="text-novalyte-400 font-semibold">{status.syncDuration}s</span>
                  </div>
                )}
              </div>

              {/* Arrow */}
              <ArrowRight className={cn('w-6 h-6 shrink-0', animateFlow && status.step === 'training' ? 'text-novalyte-400 animate-pulse' : 'text-slate-600')} />

              {/* Step 3: ML Model */}
              <div className={cn(
                'flex-1 min-w-[200px] p-4 rounded-xl border-2 transition-all duration-500',
                status.step === 'training' && animateFlow
                  ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/50'
                  : 'border-white/10 bg-white/5'
              )}>
                <div className="flex items-center gap-3 mb-2">
                  <Brain className={cn('w-6 h-6', status.step === 'training' && animateFlow ? 'text-emerald-400 animate-pulse' : 'text-slate-400')} />
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">ML Model</h4>
                    <p className="text-xs text-slate-500">BigQuery ML</p>
                  </div>
                </div>
                {status.modelAccuracy !== undefined && (
                  <div className="text-xs">
                    <span className="text-slate-500">Accuracy: </span>
                    <span className="text-emerald-400 font-semibold">{(status.modelAccuracy * 100).toFixed(1)}%</span>
                  </div>
                )}
              </div>

              {/* Arrow */}
              <ArrowRight className={cn('w-6 h-6 shrink-0', animateFlow && status.step === 'scoring' ? 'text-emerald-400 animate-pulse' : 'text-slate-600')} />

              {/* Step 4: Scores */}
              <div className={cn(
                'flex-1 min-w-[200px] p-4 rounded-xl border-2 transition-all duration-500',
                status.step === 'scoring' && animateFlow
                  ? 'border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/50'
                  : status.step === 'complete'
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-white/10 bg-white/5'
              )}>
                <div className="flex items-center gap-3 mb-2">
                  <Target className={cn('w-6 h-6', status.step === 'scoring' && animateFlow ? 'text-amber-400 animate-pulse' : status.step === 'complete' ? 'text-emerald-400' : 'text-slate-400')} />
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Propensity Scores</h4>
                    <p className="text-xs text-slate-500">Hot/Warm/Cold</p>
                  </div>
                </div>
                {status.hotProspects !== undefined && (
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Hot</span>
                      <span className="text-red-400 font-semibold">{status.hotProspects}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Warm</span>
                      <span className="text-amber-400 font-semibold">{status.warmProspects}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

        {/* Progress */}
        {status.step !== 'idle' && (
          <div className="glass-card p-6 space-y-3">
            <div className="flex items-center gap-3">
              {status.step === 'error' ? (
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              ) : status.step === 'complete' ? (
                <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <Loader2 className="w-5 h-5 text-novalyte-400 animate-spin shrink-0" />
              )}
              <div className="flex-1">
                <p className={cn('text-sm font-medium', status.step === 'error' ? 'text-red-400' : 'text-slate-200')}>
                  {status.message}
                </p>
                {status.step !== 'error' && (
                  <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-novalyte-500 rounded-full transition-all duration-500"
                      style={{ width: `${status.progress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Stats */}
            {status.clinicsSynced !== undefined && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-3 border-t border-white/[0.06]">
                {status.clinicsSynced !== undefined && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-novalyte-400">{status.clinicsSynced}</p>
                    <p className="text-[10px] text-slate-500">Clinics Synced</p>
                  </div>
                )}
                {status.leadsSynced !== undefined && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-novalyte-400">{status.leadsSynced}</p>
                    <p className="text-[10px] text-slate-500">Leads Synced</p>
                  </div>
                )}
                {status.modelAccuracy !== undefined && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-400">{(status.modelAccuracy * 100).toFixed(1)}%</p>
                    <p className="text-[10px] text-slate-500">Model Accuracy</p>
                  </div>
                )}
                {status.hotProspects !== undefined && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-red-400">{status.hotProspects}</p>
                    <p className="text-[10px] text-slate-500">Hot Prospects</p>
                  </div>
                )}
                {status.warmProspects !== undefined && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-amber-400">{status.warmProspects}</p>
                    <p className="text-[10px] text-slate-500">Warm Prospects</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      {/* Real-time Metrics Dashboard */}
      {showMetrics && status.step !== 'idle' && (
        <div className="grid md:grid-cols-4 gap-4">
          <div className="glass-card p-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-novalyte-500/10 rounded-full blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-novalyte-400" />
                <span className="text-xs text-slate-500">Pipeline Status</span>
              </div>
              <p className="text-2xl font-bold text-white capitalize">{status.step}</p>
              <div className="mt-2 flex items-center gap-1">
                <div className={cn('w-2 h-2 rounded-full', 
                  status.step === 'complete' ? 'bg-emerald-400' :
                  status.step === 'error' ? 'bg-red-400' :
                  'bg-novalyte-400 animate-pulse'
                )} />
                <span className="text-xs text-slate-500">{status.progress}% complete</span>
              </div>
            </div>
          </div>

          <div className="glass-card p-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-novalyte-500/10 rounded-full blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-novalyte-400" />
                <span className="text-xs text-slate-500">Processing Time</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {(status.syncDuration || 0) + (status.trainDuration || 0) + (status.scoreDuration || 0)}s
              </p>
              <div className="mt-2 text-xs text-slate-500">
                {status.syncDuration && <span>Sync: {status.syncDuration}s</span>}
                {status.trainDuration && <span className="ml-2">Train: {status.trainDuration}s</span>}
              </div>
            </div>
          </div>

          <div className="glass-card p-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/10 rounded-full blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-slate-500">Model Performance</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {status.modelAccuracy ? `${(status.modelAccuracy * 100).toFixed(1)}%` : '--'}
              </p>
              <div className="mt-2 text-xs text-slate-500">
                {status.modelAccuracy && status.modelAccuracy >= config.minAccuracy ? (
                  <span className="text-emerald-400">✓ Meets threshold</span>
                ) : status.modelAccuracy ? (
                  <span className="text-amber-400">⚠ Below threshold</span>
                ) : (
                  <span>Awaiting training</span>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card p-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/10 rounded-full blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-slate-500">Total Prospects</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {(status.hotProspects || 0) + (status.warmProspects || 0)}
              </p>
              <div className="mt-2 text-xs text-slate-500">
                <span className="text-red-400">{status.hotProspects || 0} hot</span>
                <span className="mx-1">•</span>
                <span className="text-amber-400">{status.warmProspects || 0} warm</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Prospects */}
      {topProspects.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between bg-novalyte-500/5">
            <div>
              <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-novalyte-400" />
                Top Prospects
                <span className="text-xs text-slate-500 font-normal ml-2">Highest propensity to convert</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">{topProspects.length} clinics ready for outreach</p>
            </div>
            <button
              onClick={exportProspects}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#06B6D4] text-[#000000] text-sm font-semibold hover:bg-[#22D3EE] transition-all"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-slate-500 border-b border-white/[0.06] bg-white/[0.02]">
                  <th className="text-left py-3 px-4 font-medium text-xs">Rank</th>
                  <th className="text-left py-3 px-4 font-medium text-xs">Clinic</th>
                  <th className="text-left py-3 px-4 font-medium text-xs">Location</th>
                  <th className="text-left py-3 px-4 font-medium text-xs">Contact</th>
                  <th className="text-left py-3 px-4 font-medium text-xs">Propensity</th>
                  <th className="text-left py-3 px-4 font-medium text-xs">Tier</th>
                  <th className="text-left py-3 px-4 font-medium text-xs">Affluence</th>
                  <th className="text-left py-3 px-4 font-medium text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {topProspects.map((p, i) => (
                  <tr key={p.clinic_id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors group">
                    <td className="py-3 px-4">
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
                        i < 3 ? 'bg-[#06B6D4] text-[#000000] shadow-lg shadow-novalyte-500/30' :
                        i < 10 ? 'bg-amber-500/20 text-amber-400' :
                        'bg-white/5 text-slate-500'
                      )}>
                        {i + 1}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-200 font-medium text-sm">{p.name}</div>
                      <div className="text-slate-500 text-xs mt-0.5 flex items-center gap-1 flex-wrap">
                        {(p.services || []).slice(0, 2).map((s: string, idx: number) => (
                          <span key={idx} className="px-1.5 py-0.5 rounded bg-white/5 text-[10px]">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-300 text-sm">{p.city}, {p.state}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="space-y-0.5">
                        {p.phone && <div className="text-slate-300 text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> {p.phone}</div>}
                        {p.email && <div className="text-slate-500 text-xs flex items-center gap-1 truncate max-w-[200px]"><Mail className="w-3 h-3" /> {p.email}</div>}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                          <div 
                            className={cn('h-full rounded-full', 
                              p.propensity_score >= 0.7 ? 'bg-gradient-to-r from-red-500 to-red-400' :
                              p.propensity_score >= 0.4 ? 'bg-gradient-to-r from-amber-500 to-amber-400' :
                              'bg-gradient-to-r from-slate-500 to-slate-400'
                            )}
                            style={{ width: `${p.propensity_score * 100}%` }}
                          />
                        </div>
                        <span className="text-novalyte-400 font-bold text-sm tabular-nums min-w-[45px]">
                          {(p.propensity_score * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold',
                        p.propensity_tier === 'hot' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                        p.propensity_tier === 'warm' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                        'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                      )}>
                        {p.propensity_tier}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <Gauge className="w-3.5 h-3.5 text-novalyte-400" />
                        <span className="text-slate-300 font-medium text-sm">{p.affluence_score}/10</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => setSelectedProspect(p)}
                        className="px-3 py-1.5 rounded-lg bg-novalyte-500/20 text-novalyte-300 text-xs font-medium hover:bg-novalyte-500/30 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pipeline History */}
      {pipelineHistory.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-slate-400" />
            Pipeline History
          </h3>
          <div className="space-y-2">
            {pipelineHistory.map((run, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-3">
                  {run.status === 'success' ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  )}
                  <div>
                    <p className="text-sm text-slate-300">{run.timestamp.toLocaleString()}</p>
                    {run.status === 'success' ? (
                      <p className="text-xs text-slate-500">
                        {run.clinics} clinics • {run.leads} leads • {(run.accuracy * 100).toFixed(1)}% accuracy • {run.hotProspects} hot prospects
                      </p>
                    ) : (
                      <p className="text-xs text-red-400">{run.error}</p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-slate-500">{run.duration}s</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="glass-card p-5 relative overflow-hidden group hover:border-novalyte-500/30 transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-novalyte-500/5 rounded-full blur-2xl group-hover:bg-novalyte-500/10 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-novalyte-500/20">
                <Database className="w-5 h-5 text-novalyte-400" />
              </div>
              <h3 className="text-sm font-semibold text-slate-200">Data Sync</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Syncs all clinics, leads, and engagement history from Supabase to BigQuery for analysis. Runs in ~30s for 1,500+ clinics.
            </p>
          </div>
        </div>

        <div className="glass-card p-5 relative overflow-hidden group hover:border-novalyte-500/30 transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/20">
                <Brain className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-sm font-semibold text-slate-200">ML Training</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Trains a logistic regression model on conversion patterns using BigQuery ML. Predicts clinic propensity with 70-80% accuracy.
            </p>
          </div>
        </div>

        <div className="glass-card p-5 relative overflow-hidden group hover:border-novalyte-500/30 transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-all" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20">
                <TrendingUp className="w-5 h-5 text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-slate-200">Scoring</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Scores all clinics 0-100% and tags as hot/warm/cold for prioritized outreach. Export top prospects for Voice Agent.
            </p>
          </div>
        </div>
      </div>

      {/* Prospect Detail Modal */}
      {selectedProspect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedProspect(null)}>
          <div className="glass-card p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold text-white">{selectedProspect.name}</h3>
                <p className="text-sm text-slate-400 mt-1">{selectedProspect.city}, {selectedProspect.state}</p>
              </div>
              <button onClick={() => setSelectedProspect(null)} className="text-slate-500 hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-slate-500 mb-1">Propensity Score</p>
                  <p className="text-2xl font-bold text-red-400">{(selectedProspect.propensity_score * 100).toFixed(0)}%</p>
                </div>
                <div className="p-4 rounded-xl bg-novalyte-500/10 border border-novalyte-500/20">
                  <p className="text-xs text-slate-500 mb-1">Affluence Score</p>
                  <p className="text-2xl font-bold text-novalyte-400">{selectedProspect.affluence_score}/10</p>
                </div>
              </div>
              
              {selectedProspect.phone && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Phone</p>
                  <p className="text-sm text-slate-200">{selectedProspect.phone}</p>
                </div>
              )}
              
              {selectedProspect.email && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Email</p>
                  <p className="text-sm text-slate-200">{selectedProspect.email}</p>
                </div>
              )}
              
              {selectedProspect.services && selectedProspect.services.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Services</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedProspect.services.map((s: string, i: number) => (
                      <span key={i} className="px-2.5 py-1 rounded-lg bg-white/5 text-xs text-slate-300">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
