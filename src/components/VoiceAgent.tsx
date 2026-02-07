import { useState } from 'react';
import { 
  Phone, 
  PhoneCall,
  PhoneOff,
  Play,
  Pause,
  Users,
  Clock,
  CheckCircle,
  XCircle,
  MessageSquare,
  RefreshCw
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { voiceAgentService } from '../services/voiceAgentService';
import { CRMContact, VoiceCall } from '../types';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

function VoiceAgent() {
  const { 
    contacts, 
    activeCalls, 
    callHistory, 
    addCall, 
    updateCall,
    completeCall,
    updateContactStatus 
  } = useAppStore();
  
  const [selectedProvider, setSelectedProvider] = useState<'vapi' | 'bland'>('vapi');
  const [isCallingAll, setIsCallingAll] = useState(false);

  const readyToCallContacts = contacts.filter(c => c.status === 'ready_to_call');

  const handleCall = async (contact: CRMContact) => {
    toast.loading(`Initiating call to ${contact.clinic.name}...`, { id: 'call' });

    try {
      let call: VoiceCall;
      
      if (selectedProvider === 'vapi') {
        call = await voiceAgentService.initiateCallVapi(contact);
      } else {
        call = await voiceAgentService.initiateCallBland(contact);
      }

      addCall(call);
      updateContactStatus(contact.id, 'called');
      toast.success('Call initiated', { id: 'call' });

      // Poll for call status
      pollCallStatus(call.id, contact.id);
    } catch (error) {
      toast.error('Failed to initiate call', { id: 'call' });
    }
  };

  const pollCallStatus = async (callId: string, contactId: string) => {
    const interval = setInterval(async () => {
      try {
        const status = await voiceAgentService.getCallStatus(callId, selectedProvider);
        
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'no_answer') {
          clearInterval(interval);
          
          // Analyze outcome if transcript available
          if (status.transcript) {
            const analysis = voiceAgentService.analyzeCallOutcome(status.transcript);
            completeCall(callId, {
              ...status,
              outcome: analysis.outcome,
              sentiment: analysis.sentiment,
              followUpRequired: analysis.followUpRequired,
            });

            // Update contact status based on outcome
            if (analysis.outcome === 'interested' || analysis.outcome === 'schedule_demo') {
              updateContactStatus(contactId, 'qualified');
            } else if (analysis.outcome === 'not_interested') {
              updateContactStatus(contactId, 'not_interested');
            } else if (analysis.followUpRequired) {
              updateContactStatus(contactId, 'follow_up');
            }
          } else {
            completeCall(callId, status);
            if (status.status === 'no_answer') {
              updateContactStatus(contactId, 'no_answer');
            }
          }
        } else {
          updateCall(callId, status);
        }
      } catch (error) {
        console.error('Error polling call status:', error);
      }
    }, 5000); // Poll every 5 seconds

    // Stop polling after 10 minutes
    setTimeout(() => clearInterval(interval), 600000);
  };

  const handleCallAll = async () => {
    if (readyToCallContacts.length === 0) {
      toast.error('No contacts ready to call');
      return;
    }

    setIsCallingAll(true);
    toast.loading(`Starting calls to ${readyToCallContacts.length} contacts...`, { id: 'batch' });

    for (const contact of readyToCallContacts) {
      await handleCall(contact);
      // Wait between calls to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    setIsCallingAll(false);
    toast.success('Batch calling complete', { id: 'batch' });
  };

  const getCallStatusIcon = (status: VoiceCall['status']) => {
    switch (status) {
      case 'queued':
        return <Clock className="w-4 h-4 text-gray-500" />;
      case 'ringing':
        return <Phone className="w-4 h-4 text-blue-500 animate-pulse" />;
      case 'in_progress':
        return <PhoneCall className="w-4 h-4 text-green-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
      case 'no_answer':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Phone className="w-4 h-4 text-gray-400" />;
    }
  };

  const getOutcomeBadge = (outcome?: VoiceCall['outcome']) => {
    if (!outcome) return null;
    
    const styles: Record<string, string> = {
      interested: 'badge-success',
      schedule_demo: 'badge-success',
      send_info: 'badge-info',
      not_interested: 'badge-danger',
      callback_requested: 'badge-warning',
      wrong_contact: 'bg-gray-100 text-gray-600',
      gatekeeper_block: 'badge-warning',
    };

    return (
      <span className={cn('badge', styles[outcome] || 'badge-info')}>
        {outcome.replace('_', ' ')}
      </span>
    );
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Voice Agent</h1>
          <p className="text-gray-600">AI-powered outbound calls to men's health clinics</p>
        </div>

        <div className="flex items-center gap-4">
          {/* Provider Selector */}
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value as 'vapi' | 'bland')}
            className="input w-32"
          >
            <option value="vapi">Vapi</option>
            <option value="bland">Bland AI</option>
          </select>

          {/* Call All Button */}
          <button
            onClick={handleCallAll}
            disabled={isCallingAll || readyToCallContacts.length === 0}
            className="btn btn-primary"
          >
            {isCallingAll ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Phone className="w-4 h-4 mr-2" />
            )}
            Call All ({readyToCallContacts.length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ready to Call */}
        <div className="card">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold flex items-center">
              <Users className="w-5 h-5 mr-2 text-green-500" />
              Ready to Call ({readyToCallContacts.length})
            </h2>
          </div>

          {readyToCallContacts.length > 0 ? (
            <div className="divide-y divide-gray-100 max-h-[400px] overflow-auto">
              {readyToCallContacts.map((contact) => (
                <div key={contact.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{contact.clinic.name}</p>
                    <p className="text-sm text-gray-500">{contact.clinic.phone}</p>
                    {contact.decisionMaker && (
                      <p className="text-xs text-gray-400">
                        {contact.decisionMaker.firstName} {contact.decisionMaker.lastName}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleCall(contact)}
                    className="btn btn-primary btn-sm"
                  >
                    <Phone className="w-4 h-4 mr-1" />
                    Call
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No contacts ready to call</p>
              <p className="text-xs mt-1">Add clinics to CRM and mark them as "Ready to Call"</p>
            </div>
          )}
        </div>

        {/* Active Calls */}
        <div className="card">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold flex items-center">
              <PhoneCall className="w-5 h-5 mr-2 text-blue-500" />
              Active Calls ({activeCalls.length})
            </h2>
          </div>

          {activeCalls.length > 0 ? (
            <div className="divide-y divide-gray-100 max-h-[400px] overflow-auto">
              {activeCalls.map((call) => {
                const contact = contacts.find(c => c.id === call.contactId);
                return (
                  <div key={call.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getCallStatusIcon(call.status)}
                      <div>
                        <p className="font-medium text-gray-900">{contact?.clinic.name || 'Unknown'}</p>
                        <p className="text-sm text-gray-500 capitalize">{call.status.replace('_', ' ')}</p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">
                      {format(call.startTime, 'h:mm a')}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">
              <PhoneCall className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No active calls</p>
            </div>
          )}
        </div>
      </div>

      {/* Call History */}
      <div className="card mt-6">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold flex items-center">
            <Clock className="w-5 h-5 mr-2 text-gray-500" />
            Call History ({callHistory.length})
          </h2>
        </div>

        {callHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Clinic</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Outcome</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sentiment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {callHistory.map((call) => {
                  const contact = contacts.find(c => c.id === call.contactId);
                  return (
                    <tr key={call.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{contact?.clinic.name || 'Unknown'}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {format(call.startTime, 'MMM d, h:mm a')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {call.duration ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getCallStatusIcon(call.status)}
                          <span className="text-sm capitalize">{call.status.replace('_', ' ')}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {getOutcomeBadge(call.outcome)}
                      </td>
                      <td className="px-4 py-3">
                        {call.sentiment && (
                          <span className={cn('badge', {
                            'badge-success': call.sentiment === 'positive',
                            'badge-warning': call.sentiment === 'neutral',
                            'badge-danger': call.sentiment === 'negative',
                          })}>
                            {call.sentiment}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-gray-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No call history yet</p>
            <p className="text-sm">Start making calls to see your history here</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default VoiceAgent;
