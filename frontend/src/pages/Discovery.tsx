import { useState } from 'react';
import { api } from '../api';
import { useApiQuery } from '../hooks/useApiQuery';
import { useSiteScope, scoped } from '../context/SiteContext';
import type { Me } from '../App';
import { PageHeader, Card, Button } from '../components/ui';
import OnboardWizard from '../components/OnboardWizard';

interface Suggestion { neighbor_name: string; neighbor_ip: string; neighbor_platform: string; protocol: string; seen_by_hostname: string; seen_by_ip: string; }
interface ImportResult { ip: string; id?: string; ok: boolean; error?: string; }

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition';

const CSV_EXAMPLE = `hostname,mgmt_ip,model,credential_id,site_id
core-sw01,10.0.0.1,WS-C3750X-48P-L,,
core-sw02,10.0.0.2,WS-C3750X-48P-L,,`;

export default function Discovery({ me }: { me: Me }) {
  const [tab, setTab] = useState<'suggest' | 'import'>('suggest');
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  // One-click add: open the onboarding wizard prefilled with a suggestion's IP.
  const [addingIp, setAddingIp] = useState<string | null>(null);
  const canAdd = me.role === 'superadmin' || me.role === 'netadmin';

  const { siteId } = useSiteScope();
  const { data: suggestions = [], isLoading: loadingSugg, refetch: loadSuggestions } =
    useApiQuery<Suggestion[]>(scoped('/api/discovery/suggest', siteId), { enabled: tab === 'suggest' });
  const { data: sites = [] } = useApiQuery<any[]>('/api/sites', { enabled: canAdd });

  async function runImport() {
    setImporting(true); setImportResults(null);
    try {
      const res = await api<{ results: ImportResult[] }>('/api/devices/import', {
        method: 'POST', body: JSON.stringify({ csv })
      });
      setImportResults(res.results);
    } catch { setImportResults([]); } finally { setImporting(false); }
  }

  return (
    <div>
      <PageHeader title="Discovery & Import" />

      <div className="flex gap-1 px-6 pb-4">
        {(['suggest', 'import'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}>
            {t === 'suggest' ? 'CDP/LLDP Suggestions' : 'CSV Import'}
          </button>
        ))}
      </div>

      <div className="px-6 pb-6">
        {tab === 'suggest' && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-slate-600">
                Devices discovered via CDP/LLDP from your managed switches that aren't yet in SwitchPilot.
              </p>
              <Button variant="secondary" onClick={loadSuggestions} disabled={loadingSugg}>
                {loadingSugg ? 'Loading…' : 'Refresh'}
              </Button>
            </div>
            {suggestions.length === 0 && !loadingSugg ? (
              <div className="py-10 text-center text-sm text-slate-400">
                No undiscovered neighbors — all CDP/LLDP neighbors are already managed,
                or no devices have been refreshed yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left">
                      <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Hostname</th>
                      <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">IP</th>
                      <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Platform</th>
                      <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Protocol</th>
                      <th className="pb-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Seen by</th>
                      {canAdd && <th className="pb-3"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {suggestions.map(s => (
                      <tr key={`${s.neighbor_ip}-${s.seen_by_ip}`} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 pr-4 font-medium text-slate-800">{s.neighbor_name || '—'}</td>
                        <td className="py-3 pr-4 font-mono text-xs text-slate-700">{s.neighbor_ip}</td>
                        <td className="max-w-64 truncate py-3 pr-4 text-slate-600" title={s.neighbor_platform}>{s.neighbor_platform || '—'}</td>
                        <td className="py-3 pr-4">
                          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            s.protocol === 'cdp' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                          }`}>{s.protocol.toUpperCase()}</span>
                        </td>
                        <td className="py-3 pr-4 text-xs text-slate-500">{s.seen_by_hostname || s.seen_by_ip}</td>
                        {canAdd && (
                          <td className="py-3 text-right">
                            <Button variant="secondary" disabled={!s.neighbor_ip}
                                    onClick={() => setAddingIp(s.neighbor_ip)}>
                              Add…
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-slate-400">
                  {canAdd
                    ? 'Add… opens onboarding with the IP prefilled, or use the CSV Import tab to bulk-import.'
                    : 'A netadmin can add these from here or via the Devices page.'}
                </p>
              </div>
            )}
          </Card>
        )}

        {tab === 'import' && (
          <div className="space-y-4">
            <Card>
              <p className="mb-3 text-sm text-slate-600">
                Paste CSV with a header row. Required column: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">mgmt_ip</code>.
                Optional: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">hostname</code>,{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">model</code>,{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">credential_id</code>,{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">site_id</code>.
              </p>
              <textarea
                className={`${inputCls} font-mono text-xs`}
                rows={10}
                placeholder={CSV_EXAMPLE}
                value={csv}
                onChange={e => setCsv(e.target.value)}
              />
              <div className="mt-3 flex justify-end">
                <Button onClick={runImport} disabled={importing || !csv.trim()}>
                  {importing ? 'Importing…' : 'Import'}
                </Button>
              </div>
            </Card>

            {importResults && (
              <Card>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  {importResults.filter(r => r.ok).length} / {importResults.length} imported successfully
                </p>
                <div className="space-y-1">
                  {importResults.map((r, i) => (
                    <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                      r.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                    }`}>
                      <span className="font-mono text-xs">{r.ip}</span>
                      {r.ok
                        ? <span className="text-green-600">— imported</span>
                        : <span className="text-red-600">— {r.error}</span>
                      }
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
      {addingIp && (
        <OnboardWizard
          sites={sites}
          initialIp={addingIp}
          onClose={() => { setAddingIp(null); loadSuggestions(); }}
        />
      )}
    </div>
  );
}
