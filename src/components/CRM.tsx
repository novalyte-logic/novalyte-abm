import { useState } from 'react';
import { 
  Users, 
  Search, 
  Filter,
  Phone,
  Mail,
  Building2,
  MapPin,
  Star,
  ChevronRight,
  X
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { CRMContact, ContactStatus, Priority } from '../types';
import { cn } from '../utils/cn';

const statusOptions: { value: ContactStatus; label: string; color: string }[] = [
  { value: 'new', label: 'New', color: 'bg-gray-100 text-gray-800' },
  { value: 'researching', label: 'Researching', color: 'bg-blue-100 text-blue-800' },
  { value: 'ready_to_call', label: 'Ready to Call', color: 'bg-green-100 text-green-800' },
  { value: 'call_scheduled', label: 'Call Scheduled', color: 'bg-purple-100 text-purple-800' },
  { value: 'called', label: 'Called', color: 'bg-indigo-100 text-indigo-800' },
  { value: 'follow_up', label: 'Follow Up', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'qualified', label: 'Qualified', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'not_interested', label: 'Not Interested', color: 'bg-red-100 text-red-800' },
  { value: 'no_answer', label: 'No Answer', color: 'bg-orange-100 text-orange-800' },
  { value: 'wrong_number', label: 'Wrong Number', color: 'bg-gray-100 text-gray-800' },
];

const priorityOptions: { value: Priority; label: string; color: string }[] = [
  { value: 'critical', label: 'Critical', color: 'bg-red-500' },
  { value: 'high', label: 'High', color: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500' },
  { value: 'low', label: 'Low', color: 'bg-gray-400' },
];

function CRM() {
  const { contacts, selectedContact, selectContact, updateContact, updateContactStatus } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContactStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>('');

  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = searchQuery === '' || 
      contact.clinic.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.clinic.address.city.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === '' || contact.status === statusFilter;
    const matchesPriority = priorityFilter === '' || contact.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const getStatusBadge = (status: ContactStatus) => {
    const option = statusOptions.find(o => o.value === status);
    return option ? (
      <span className={cn('badge', option.color)}>
        {option.label}
      </span>
    ) : null;
  };

  const getPriorityIndicator = (priority: Priority) => {
    const option = priorityOptions.find(o => o.value === priority);
    return option ? (
      <div className={cn('w-2 h-2 rounded-full', option.color)} title={option.label} />
    ) : null;
  };

  return (
    <div className="flex h-full">
      {/* Contact List */}
      <div className={cn(
        'flex flex-col border-r border-gray-200 bg-white transition-all',
        selectedContact ? 'w-1/2' : 'w-full'
      )}>
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">CRM</h1>
          
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ContactStatus | '')}
              className="input text-sm"
            >
              <option value="">All Status</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority | '')}
              className="input text-sm"
            >
              <option value="">All Priority</option>
              {priorityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Contact List */}
        <div className="flex-1 overflow-auto">
          {filteredContacts.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => selectContact(contact)}
                  className={cn(
                    'w-full p-4 text-left hover:bg-gray-50 transition-colors flex items-center gap-3',
                    selectedContact?.id === contact.id && 'bg-novalyte-50'
                  )}
                >
                  {getPriorityIndicator(contact.priority)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-medium text-gray-900 truncate">{contact.clinic.name}</h3>
                      <span className="text-xs text-gray-500">Score: {contact.score}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">
                        {contact.clinic.address.city}, {contact.clinic.address.state}
                      </span>
                      {getStatusBadge(contact.status)}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No contacts found</p>
              <p className="text-sm">Discover clinics and add them to your CRM</p>
            </div>
          )}
        </div>
      </div>

      {/* Contact Detail */}
      {selectedContact && (
        <div className="w-1/2 flex flex-col bg-gray-50 overflow-auto">
          {/* Header */}
          <div className="p-6 bg-white border-b border-gray-200 flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{selectedContact.clinic.name}</h2>
              <p className="text-gray-500">{selectedContact.clinic.type.replace('_', ' ')}</p>
            </div>
            <button onClick={() => selectContact(null)} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Status & Priority */}
            <div className="card p-4">
              <h3 className="font-medium text-gray-900 mb-3">Status</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-500 block mb-1">Contact Status</label>
                  <select
                    value={selectedContact.status}
                    onChange={(e) => updateContactStatus(selectedContact.id, e.target.value as ContactStatus)}
                    className="input text-sm"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-500 block mb-1">Priority Score</label>
                  <div className="flex items-center gap-2">
                    <div className="text-2xl font-bold text-novalyte-600">{selectedContact.score}</div>
                    <span className={cn('badge', {
                      'badge-danger': selectedContact.priority === 'critical',
                      'badge-warning': selectedContact.priority === 'high',
                      'badge-info': selectedContact.priority === 'medium',
                      'bg-gray-100 text-gray-600': selectedContact.priority === 'low',
                    })}>
                      {selectedContact.priority}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Clinic Info */}
            <div className="card p-4">
              <h3 className="font-medium text-gray-900 mb-3">Clinic Information</h3>
              <div className="space-y-3">
                <div className="flex items-start">
                  <MapPin className="w-4 h-4 mt-0.5 mr-3 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-900">{selectedContact.clinic.address.street}</p>
                    <p className="text-sm text-gray-500">
                      {selectedContact.clinic.address.city}, {selectedContact.clinic.address.state} {selectedContact.clinic.address.zip}
                    </p>
                  </div>
                </div>
                {selectedContact.clinic.phone && (
                  <div className="flex items-center">
                    <Phone className="w-4 h-4 mr-3 text-gray-400" />
                    <a href={`tel:${selectedContact.clinic.phone}`} className="text-sm text-novalyte-600 hover:underline">
                      {selectedContact.clinic.phone}
                    </a>
                  </div>
                )}
                {selectedContact.clinic.rating && (
                  <div className="flex items-center">
                    <Star className="w-4 h-4 mr-3 text-yellow-400 fill-yellow-400" />
                    <span className="text-sm">
                      {selectedContact.clinic.rating} ({selectedContact.clinic.reviewCount} reviews)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Decision Maker */}
            {selectedContact.decisionMaker && (
              <div className="card p-4">
                <h3 className="font-medium text-gray-900 mb-3">Decision Maker</h3>
                <div className="space-y-2">
                  <p className="text-lg font-medium">
                    {selectedContact.decisionMaker.firstName} {selectedContact.decisionMaker.lastName}
                  </p>
                  <p className="text-sm text-gray-500">{selectedContact.decisionMaker.title}</p>
                  {selectedContact.decisionMaker.email && (
                    <div className="flex items-center">
                      <Mail className="w-4 h-4 mr-2 text-gray-400" />
                      <a href={`mailto:${selectedContact.decisionMaker.email}`} className="text-sm text-novalyte-600 hover:underline">
                        {selectedContact.decisionMaker.email}
                      </a>
                    </div>
                  )}
                  {selectedContact.decisionMaker.phone && (
                    <div className="flex items-center">
                      <Phone className="w-4 h-4 mr-2 text-gray-400" />
                      <a href={`tel:${selectedContact.decisionMaker.phone}`} className="text-sm text-novalyte-600 hover:underline">
                        {selectedContact.decisionMaker.phone}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Keyword Matches */}
            {selectedContact.keywordMatches.length > 0 && (
              <div className="card p-4">
                <h3 className="font-medium text-gray-900 mb-3">Keyword Matches</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedContact.keywordMatches.map((trend) => (
                    <span key={trend.id} className="badge badge-info">
                      {trend.keyword} (+{trend.growthRate}%)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="card p-4">
              <h3 className="font-medium text-gray-900 mb-3">Notes</h3>
              <textarea
                value={selectedContact.notes}
                onChange={(e) => updateContact(selectedContact.id, { notes: e.target.value })}
                placeholder="Add notes about this contact..."
                className="input min-h-[100px]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CRM;
