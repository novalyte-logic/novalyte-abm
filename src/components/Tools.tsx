import { DownloadCloud, Trash2 } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

export default function Tools() {
  const state = useAppStore.getState();

  const handleExport = () => {
    try {
      const payload = JSON.stringify(state, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `novalyte-store-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to export state', err);
      alert('Failed to export state. See console for details.');
    }
  };

  const handleClear = () => {
    // eslint-disable-next-line no-restricted-globals
    const ok = confirm('⚠️ Factory Reset: This will clear ALL data across every tab and reload the app. Continue?');
    if (!ok) return;
    useAppStore.getState().factoryReset();
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={handleExport}
        title="Export persisted state"
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-novalyte-300 hover:bg-novalyte-900 hover:text-white transition-colors"
      >
        <DownloadCloud className="w-4 h-4" />
        <span>Export</span>
      </button>

      <button
        onClick={handleClear}
        title="Clear persisted state"
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-300 hover:bg-red-900 hover:text-white transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        <span>Clear</span>
      </button>
    </div>
  );
}
