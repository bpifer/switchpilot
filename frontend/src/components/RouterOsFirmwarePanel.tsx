import { useState } from 'react';
import { api } from '../api';
import { useAction } from '../hooks/useAction';
import { Button } from './ui';

// RouterOS firmware for one MikroTik device: the installed RouterOS package + the
// RouterBOARD bootloader firmware, with staged (non-disruptive) upgrade actions
// and an explicit reboot to apply. Checked on demand so a device SSH round-trip
// doesn't slow the page. Rendered as a self-contained block so the Firmware page
// can list one per MikroTik device under a single "RouterOS firmware" section.
interface RouterOsFw {
  version: string; architecture: string; channel: string;
  latestVersion: string; updateStatus: string; osUpdateAvailable: boolean;
  updateDownloaded: boolean;
  routerboardModel: string; currentFirmware: string; upgradeFirmware: string;
  routerboardUpgradeAvailable: boolean;
  freeHddBytes: number; totalHddBytes: number; lowDiskForUpdate: boolean;
}
const fmtMB = (b: number) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;

export default function RouterOsFirmwarePanel({ deviceId, hostname, canConfig }: {
  deviceId: string; hostname?: string; canConfig: boolean;
}) {
  const [fw, setFw] = useState<RouterOsFw | null>(null);
  // Reboot-to-apply only becomes available once something is actually staged:
  // the OS package reports downloaded, or the operator just staged the
  // bootloader upgrade this session. Rebooting with nothing staged is a no-op.
  const [rbStaged, setRbStaged] = useState(false);
  const { run, busy, isBusy } = useAction();
  const base = `/api/devices/${deviceId}/routeros-firmware`;
  const canReboot = !!fw && (fw.updateDownloaded || rbStaged);

  const check = () => run(async () => setFw(await api<RouterOsFw>(base)), { key: 'check' });
  const download = () => run(async () => {
    await api(`${base}/download`, { method: 'POST' }); await check();
  }, { key: 'download', success: 'RouterOS package downloaded and staged. Reboot to apply.' });
  const stageRb = () => run(async () => {
    await api(`${base}/routerboard-upgrade`, { method: 'POST' });
    setRbStaged(true);
  }, { key: 'rb', success: 'Bootloader firmware upgrade staged. Reboot to apply.' });
  const reboot = () => {
    if (!confirm('Reboot now to apply staged firmware? The device will be unreachable for 1–2 minutes.')) return;
    run(async () => { await api(`${base}/reboot`, { method: 'POST', body: { confirm: 'REBOOT' } }); setRbStaged(false); },
      { key: 'reboot', success: 'Reboot issued — the device will apply staged firmware and come back shortly.' });
  };

  return (
    <div className="py-3">
      {!fw ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            {hostname && <span className="font-medium text-slate-800">{hostname}</span>}
            <p className="text-slate-500">Check the installed RouterOS + RouterBOARD (bootloader) firmware and whether upgrades are available.</p>
          </div>
          <Button variant="secondary" onClick={check} disabled={busy}>{isBusy('check') ? 'Checking…' : 'Check firmware'}</Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {hostname && <div className="font-medium text-slate-800">{hostname}</div>}
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">RouterOS</div>
              <div className="font-mono text-slate-800">{fw.version} <span className="text-xs text-slate-400">({fw.channel || 'stable'}, {fw.architecture})</span></div>
              <div className={`text-xs ${fw.updateDownloaded ? 'text-blue-600' : fw.osUpdateAvailable ? 'text-amber-600' : 'text-slate-400'}`}>
                {fw.updateDownloaded ? `${fw.latestVersion} downloaded — reboot to apply`
                  : fw.osUpdateAvailable ? `${fw.latestVersion} available (not downloaded yet)`
                  : (fw.updateStatus || 'Up to date')}
              </div>
              {fw.freeHddBytes > 0 && (
                <div className={`text-xs ${fw.lowDiskForUpdate ? 'text-red-600' : 'text-slate-400'}`}>
                  {fmtMB(fw.freeHddBytes)} free of {fmtMB(fw.totalHddBytes)}
                  {fw.lowDiskForUpdate && ' — likely too little space to download the update'}
                </div>
              )}
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">RouterBOARD firmware</div>
              <div className="font-mono text-slate-800">
                {fw.currentFirmware || '—'}
                {fw.routerboardUpgradeAvailable && <span className="text-amber-600"> → {fw.upgradeFirmware}</span>}
              </div>
              <div className="text-xs text-slate-400">{fw.routerboardUpgradeAvailable ? 'Bootloader upgrade available (bundled — no download)' : 'Bootloader up to date'}</div>
            </div>
          </div>

          {canConfig && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              {fw.osUpdateAvailable && !fw.updateDownloaded && (
                <Button variant="secondary" disabled={busy} onClick={download}>
                  {isBusy('download') ? 'Downloading…' : `Download ${fw.latestVersion}`}
                </Button>
              )}
              {fw.routerboardUpgradeAvailable && (
                <Button variant="secondary" disabled={busy} onClick={stageRb}>{isBusy('rb') ? 'Staging…' : 'Stage bootloader upgrade'}</Button>
              )}
              {canReboot && (
                <Button variant="danger" disabled={busy} onClick={reboot}>{isBusy('reboot') ? 'Rebooting…' : 'Reboot to apply'}</Button>
              )}
              <Button variant="secondary" disabled={busy} onClick={check}>↻</Button>
              <span className="text-xs text-slate-400">
                {canReboot ? 'Downloads/staging are non-disruptive; only a reboot applies them.'
                  : 'Download or stage an upgrade first — the reboot button appears once something is staged.'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
