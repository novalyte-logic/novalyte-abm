import { useMemo, useState } from 'react';
import { Bot, Send, X, Sparkles } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { vertexAI } from '../services/vertexAI';
import { cn } from '../utils/cn';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

function id() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function EngineCopilot({
  currentView,
  mode,
}: {
  currentView: string;
  mode: 'demo' | 'live';
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: id(),
      role: 'assistant',
      text: 'Gemini Copilot ready. I can scan your engine state and recommend next best actions for more qualified leads.',
    },
  ]);

  const { markets, clinics, contacts, callHistory, sentEmails, keywordTrends } = useAppStore();

  const engineSnapshot = useMemo(() => {
    const readyToCall = contacts.filter(c => c.status === 'ready_to_call').length;
    const highScore = contacts.filter(c => c.score >= 80).length;
    return {
      mode,
      currentView,
      markets: markets.length,
      clinics: clinics.length,
      contacts: contacts.length,
      readyToCall,
      highScore,
      calls: callHistory.length,
      emails: sentEmails.length,
      trends: keywordTrends.length,
    };
  }, [mode, currentView, markets.length, clinics.length, contacts, callHistory.length, sentEmails.length, keywordTrends.length]);

  const askCopilot = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    setPrompt('');
    const userMessage: Message = { id: id(), role: 'user', text: q };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const snapshotText = JSON.stringify(engineSnapshot, null, 2);
      const response = await vertexAI.generateContent({
        model: 'gemini-2.0-flash',
        temperature: 0.3,
        maxOutputTokens: 900,
        systemInstruction: 'You are Novalyte Command Copilot. Be concise, action-oriented, and specific with recommendations.',
        prompt: `You are analyzing an intelligence engine dashboard state.

ENGINE SNAPSHOT:
${snapshotText}

USER REQUEST:
${q}

Return:
1) Current state diagnosis
2) Top 3 optimizations to increase pre-qualified leads
3) Immediate next action (single best action)
4) Risks/blind spots

If internet browsing is required, clearly say what external inputs are missing.`,
      });

      const assistant: Message = {
        id: id(),
        role: 'assistant',
        text: response.text?.trim() || 'No output received from Gemini.',
      };
      setMessages(prev => [...prev, assistant]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: id(),
        role: 'assistant',
        text: `Copilot error: ${err?.message || 'Unable to reach Gemini.'}`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[70]">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-cyan-400/40 bg-black/80 px-4 py-2 text-cyan-300 backdrop-blur-xl shadow-[0_0_24px_rgba(34,211,238,0.25)]"
        >
          <Bot className="w-4 h-4" />
          <span className="text-xs font-semibold">Gemini Copilot</span>
        </button>
      )}

      {open && (
        <div className="w-[360px] max-w-[92vw] rounded-2xl border border-cyan-400/30 bg-black/90 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-300" />
              <span className="text-xs font-semibold text-slate-200">Gemini Engine Copilot</span>
              <span className={cn(
                'text-[10px] rounded-full px-2 py-0.5 border',
                mode === 'live' ? 'text-emerald-300 border-emerald-400/40 bg-emerald-500/15' : 'text-amber-300 border-amber-400/40 bg-amber-500/10'
              )}>
                {mode.toUpperCase()}
              </span>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="h-72 overflow-y-auto space-y-2 px-3 py-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'rounded-lg px-3 py-2 text-xs whitespace-pre-wrap',
                  m.role === 'assistant' ? 'bg-white/[0.04] text-slate-200 border border-white/[0.06]' : 'bg-cyan-500/15 text-cyan-100 border border-cyan-400/30'
                )}
              >
                {m.text}
              </div>
            ))}
            {loading && <div className="text-[11px] text-slate-500">Analyzing engine...</div>}
          </div>

          <div className="border-t border-white/[0.08] p-3 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => askCopilot('Scan the entire engine and recommend next best action for more pre-qualified leads.')}
                disabled={loading}
                className="rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.07] disabled:opacity-40"
              >
                Scan Engine
              </button>
              <button
                onClick={() => askCopilot('What should we optimize this hour to improve conversion quality?')}
                disabled={loading}
                className="rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.07] disabled:opacity-40"
              >
                Next Best Action
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') askCopilot(prompt); }}
                placeholder="Ask Copilot..."
                className="flex-1 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400/50"
              />
              <button
                onClick={() => askCopilot(prompt)}
                disabled={loading || !prompt.trim()}
                className="rounded-lg border border-cyan-400/40 bg-cyan-500/20 px-3 text-cyan-200 disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
