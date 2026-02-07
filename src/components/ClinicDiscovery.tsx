import { useState } from 'react';
import { 
  Building2, 
  Search, 
  RefreshCw,
  MapPin,
  Star,
  Phone,
  Globe,
  Plus,
  ExternalLink
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { clinicService } from '../services/clinicService';
import { enrichmentService } from '../services/enrichmentService';
import { Clinic, CRMContact } from '../types';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';

function ClinicDiscovery() {
  const { 
    markets, 
    selectedMarket, 
    selectMarket, 
    clinics, 
    addClinics, 
    isDiscovering, 
    setIsDiscovering,
    addContact,
    keywordTrends
  } = useAppStore();

  const handleDiscoverClinics = async () => {
    if (!selectedMarket) {
      toast.error('Please select a market first');
      return;
    }

    setIsDiscovering(true);
    toast.loading('Discovering clinics...', { id: 'discovering' });

    try {
      const discoveredClinics = await clinicService.discoverClinicsInMarket(selectedMarket);
      addClinics(discoveredClinics);
      toast.success(`Found ${discoveredClinics.length} clinics in ${selectedMarket.city}`, { id: 'discovering' });
    } catch (error) {
      toast.error('Failed to discover clinics', { id: 'discovering' });
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleAddToCRM = async (clinic: Clinic) => {
    toast.loading('Adding to CRM and enriching...', { id: 'adding' });

    try {
      // Find decision makers
      const decisionMakers = await enrichmentService.findDecisionMakers(clinic);
      
      // Find relevant keyword trends for this market
      const relevantTrends = keywordTrends.filter(
        t => t.location.id === clinic.marketZone.id
      );

      // Calculate priority score
      const affluenceScore = clinic.marketZone.affluenceScore * 10;
      const trendScore = relevantTrends.length > 0 
        ? relevantTrends.reduce((sum, t) => sum + t.trendScore, 0) / relevantTrends.length
        : 50;
      const score = Math.round((affluenceScore + trendScore) / 2);

      const contact: CRMContact = {
        id: `contact-${clinic.id}-${Date.now()}`,
        clinic,
        decisionMaker: decisionMakers[0], // Primary decision maker
        status: decisionMakers.length > 0 ? 'ready_to_call' : 'researching',
        priority: score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 40 ? 'medium' : 'low',
        score,
        tags: clinic.services,
        notes: '',
        keywordMatches: relevantTrends.slice(0, 5),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      addContact(contact);
      toast.success('Added to CRM', { id: 'adding' });
    } catch (error) {
      toast.error('Failed to add to CRM', { id: 'adding' });
    }
  };

  const filteredClinics = selectedMarket 
    ? clinics.filter(c => c.marketZone.id === selectedMarket.id)
    : clinics;

  const getClinicTypeLabel = (type: Clinic['type']) => {
    const labels: Record<Clinic['type'], string> = {
      mens_health_clinic: "Men's Health",
      hormone_clinic: 'Hormone Therapy',
      med_spa: 'Med Spa',
      urology_practice: 'Urology',
      anti_aging_clinic: 'Anti-Aging',
      wellness_center: 'Wellness',
      aesthetic_clinic: 'Aesthetic',
    };
    return labels[type];
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Clinic Discovery</h1>
        <p className="text-gray-600">Find men's health clinics in affluent markets</p>
      </div>

      {/* Search Controls */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[250px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <MapPin className="w-4 h-4 inline mr-1" />
              Select Market
            </label>
            <select
              value={selectedMarket?.id || ''}
              onChange={(e) => {
                const market = markets.find(m => m.id === e.target.value);
                selectMarket(market || null);
              }}
              className="input"
            >
              <option value="">All Markets</option>
              {markets.map((market) => (
                <option key={market.id} value={market.id}>
                  {market.city}, {market.state} - ${(market.medianIncome / 1000).toFixed(0)}k median income
                </option>
              ))}
            </select>
          </div>

          <div className="pt-6">
            <button
              onClick={handleDiscoverClinics}
              disabled={isDiscovering || !selectedMarket}
              className="btn btn-primary"
            >
              {isDiscovering ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Search className="w-4 h-4 mr-2" />
              )}
              Discover Clinics
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredClinics.length > 0 ? (
          filteredClinics.map((clinic) => (
            <div key={clinic.id} className="card p-6 hover:shadow-md transition-shadow">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-1">{clinic.name}</h3>
                  <span className="badge badge-info">{getClinicTypeLabel(clinic.type)}</span>
                </div>
                {clinic.rating && (
                  <div className="flex items-center text-sm">
                    <Star className="w-4 h-4 text-yellow-400 fill-yellow-400 mr-1" />
                    <span className="font-medium">{clinic.rating}</span>
                    <span className="text-gray-400 ml-1">({clinic.reviewCount})</span>
                  </div>
                )}
              </div>

              {/* Address */}
              <div className="flex items-start text-sm text-gray-600 mb-3">
                <MapPin className="w-4 h-4 mt-0.5 mr-2 flex-shrink-0" />
                <div>
                  <p>{clinic.address.street}</p>
                  <p>{clinic.address.city}, {clinic.address.state} {clinic.address.zip}</p>
                </div>
              </div>

              {/* Contact */}
              {clinic.phone && (
                <div className="flex items-center text-sm text-gray-600 mb-2">
                  <Phone className="w-4 h-4 mr-2" />
                  <a href={`tel:${clinic.phone}`} className="hover:text-novalyte-600">
                    {clinic.phone}
                  </a>
                </div>
              )}

              {clinic.website && (
                <div className="flex items-center text-sm text-gray-600 mb-4">
                  <Globe className="w-4 h-4 mr-2" />
                  <a 
                    href={clinic.website} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="hover:text-novalyte-600 flex items-center"
                  >
                    Website <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </div>
              )}

              {/* Services */}
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Services</p>
                <div className="flex flex-wrap gap-1">
                  {clinic.services.slice(0, 4).map((service) => (
                    <span key={service} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {service}
                    </span>
                  ))}
                  {clinic.services.length > 4 && (
                    <span className="text-xs text-gray-400">+{clinic.services.length - 4} more</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <button
                onClick={() => handleAddToCRM(clinic)}
                className="btn btn-primary w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add to CRM
              </button>
            </div>
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-gray-500">
            <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No clinics discovered yet</p>
            <p className="text-sm mb-4">Select a market and click "Discover Clinics" to find men's health providers</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClinicDiscovery;
