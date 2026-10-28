import { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Key, Save, Database, GitBranch } from 'lucide-react';
import toast from 'react-hot-toast';
import DataBackup from '../components/DataBackup';
import { credentialClient } from '../services/credentialClient';
import {
  aiBudgetClient,
  formatAIBudgetMicrousd,
  parseAIBudgetUsdInput,
} from '../services/budgetClient';
import { aiRuntimeStatusClient } from '../services/aiRuntimeStatusClient';
import {
  AI_RUNTIME_READ_STATES,
  getAIRuntimeStatusDisplay,
} from '../services/aiRuntimeStatusDisplay';
import { aiPreferenceClient } from '../services/aiPreferenceClient';
import { AI_DEFAULT_PREFERENCES } from '../../shared/ai/preferenceTransportContracts.mjs';
import { getAIModel, listAIModels } from '../../shared/ai/modelCatalog.mjs';

const CREDENTIAL_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'openai', label: 'OpenAI (opsi masa depan)' }),
  Object.freeze({ id: 'gemini', label: 'Gemini' }),
]);

const AI_PREFERENCE_MODELS = listAIModels({ capability: 'chat' });

export function CredentialSettingsSection({
  client = credentialClient,
  budgetService = aiBudgetClient,
  runtimeService = aiRuntimeStatusClient,
  preferenceService = aiPreferenceClient,
}) {
  const [credentialStatus, setCredentialStatus] = useState(null);
  const [budgetStatus, setBudgetStatus] = useState(null);
  const [runtimeStatus, setRuntimeStatus] = useState(null);
  const [runtimeReadState, setRuntimeReadState] = useState(AI_RUNTIME_READ_STATES.LOADING);
  const [preferenceStatus, setPreferenceStatus] = useState(null);
  const [preferenceDraft, setPreferenceDraft] = useState(AI_DEFAULT_PREFERENCES);
  const [drafts, setDrafts] = useState({ openai: '', gemini: '' });
  const [budgetDraft, setBudgetDraft] = useState({ daily: '', monthly: '' });
  const [pendingProvider, setPendingProvider] = useState(null);
  const [budgetPending, setBudgetPending] = useState(false);
  const [preferencePending, setPreferencePending] = useState(false);
  const credentialMutationsAvailable = client.canMutate();
  const budgetMutationsAvailable = budgetService.canMutate();

  const clearDraft = (provider) => {
    setDrafts(current => ({ ...current, [provider]: '' }));
  };

  const loadCredentialStatus = async () => {
    try {
      setCredentialStatus(await client.getStatus());
    } catch {
      setCredentialStatus(null);
    }
  };

  const loadBudgetStatus = async () => {
    try {
      setBudgetStatus(await budgetService.getStatus());
    } catch {
      setBudgetStatus(null);
    }
  };

  const loadPreferenceStatus = async () => {
    try {
      const status = await preferenceService.getStatus();
      setPreferenceStatus(status);
      setPreferenceDraft(status.preferences);
    } catch {
      setPreferenceStatus(null);
    }
  };

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      client.getStatus(),
      budgetService.getStatus(),
      runtimeService.getStatus(),
      preferenceService.getStatus(),
    ]).then(([credentialResult, budgetResult, runtimeResult, preferenceResult]) => {
      if (!active) return;
      setCredentialStatus(credentialResult.status === 'fulfilled' ? credentialResult.value : null);
      setBudgetStatus(budgetResult.status === 'fulfilled' ? budgetResult.value : null);
      setRuntimeStatus(runtimeResult.status === 'fulfilled' ? runtimeResult.value : null);
      setRuntimeReadState(runtimeResult.status === 'fulfilled'
        ? AI_RUNTIME_READ_STATES.READY
        : AI_RUNTIME_READ_STATES.UNREADABLE);
      const nextPreferenceStatus = preferenceResult.status === 'fulfilled' ? preferenceResult.value : null;
      setPreferenceStatus(nextPreferenceStatus);
      if (nextPreferenceStatus) setPreferenceDraft(nextPreferenceStatus.preferences);
    });
    return () => { active = false; };
  }, [budgetService, client, preferenceService, runtimeService]);

  const submitCredential = async (provider) => {
    const value = drafts[provider];
    if (!client.canMutate(provider) || value.length === 0) return;
    const configured = credentialStatus?.providers?.[provider] === 'configured';
    setPendingProvider(provider);
    try {
      await client.configure(
        provider,
        configured ? client.configurationModes.REPLACE : client.configurationModes.CREATE,
        value,
      );
      toast.success(`Credential ${provider === 'openai' ? 'OpenAI' : 'Gemini'} berhasil diproses.`);
      await loadCredentialStatus();
    } catch {
      toast.error('Credential tidak dapat diproses. Tidak ada nilai yang ditampilkan kembali.');
    } finally {
      clearDraft(provider);
      setPendingProvider(null);
    }
  };

  const removeCredential = async (provider) => {
    if (!client.canMutate(provider)) return;
    setPendingProvider(provider);
    try {
      await client.remove(provider);
      toast.success(`Credential ${provider === 'openai' ? 'OpenAI' : 'Gemini'} berhasil diproses.`);
      await loadCredentialStatus();
    } catch {
      toast.error('Credential tidak dapat dihapus.');
    } finally {
      clearDraft(provider);
      setPendingProvider(null);
    }
  };

  const submitBudget = async () => {
    if (!budgetMutationsAvailable) return;
    const dailyLimitMicrousd = parseAIBudgetUsdInput(budgetDraft.daily);
    const monthlyLimitMicrousd = parseAIBudgetUsdInput(budgetDraft.monthly);
    if (
      dailyLimitMicrousd === null
      || monthlyLimitMicrousd === null
      || dailyLimitMicrousd > monthlyLimitMicrousd
    ) {
      toast.error('Batas anggaran tidak valid. Batas harian harus positif dan tidak melebihi batas bulanan.');
      return;
    }
    setBudgetPending(true);
    try {
      const result = await budgetService.configure({
        consentVersion: 1,
        dailyLimitMicrousd,
        monthlyLimitMicrousd,
      });
      if (result.changed) toast.success('Batas estimasi biaya AI berhasil diproses.');
      else toast('Perubahan batas estimasi biaya AI dibatalkan.');
      await loadBudgetStatus();
    } catch {
      toast.error('Batas estimasi biaya AI tidak dapat diproses.');
    } finally {
      setBudgetPending(false);
    }
  };

  const submitPreferences = async () => {
    setPreferencePending(true);
    try {
      await preferenceService.update(preferenceDraft);
      toast.success('Preferensi model AI berhasil disimpan.');
      await loadPreferenceStatus();
    } catch {
      toast.error('Preferensi AI tidak dapat disimpan. File rusak tidak akan ditimpa otomatis.');
    } finally {
      setPreferencePending(false);
    }
  };

  const runtimeDisplay = getAIRuntimeStatusDisplay(runtimeStatus, runtimeReadState);
  const gatewayState = runtimeDisplay.gateway;
  const productionState = runtimeDisplay.production;
  const availableModels = runtimeStatus?.models?.available
    ?.map(modelId => getAIModel(modelId)?.label ?? modelId)
    .join(', ') || 'tidak tersedia';
  const partialModels = runtimeStatus?.models?.partiallyVerified
    ?.map(modelId => getAIModel(modelId)?.label ?? modelId)
    .join(', ') || 'tidak ada';

  return (
    <div id="section-ai" className="glass-card" tabIndex="-1" style={{ padding: '1.5rem', border: '1px solid var(--border-color)', outline: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <Key size={20} style={{ color: '#8b5cf6' }} />
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Status AI Aman</h3>
      </div>
      <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        Credential hanya dikelola backend Electron dan tidak dapat dibaca kembali. Legacy Gemini key browser tidak dibaca maupun diubah.
      </p>
      <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem', padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', fontSize: '0.85rem' }}>
        <div><strong>Target utama:</strong> Electron packaged Windows</div>
        <div><strong>Profil penyimpanan:</strong> profil Electron yang sama pada setiap restart</div>
        <div><strong>Gateway:</strong> {gatewayState} · <strong>AI production:</strong> {productionState}</div>
        <div><strong>Routing:</strong> Gemini utama · tanpa fallback otomatis ke OpenAI</div>
        <div><strong>Model aktif:</strong> {availableModels}</div>
        <div><strong>Belum dapat dipilih:</strong> {partialModels}</div>
      </div>
      {!credentialMutationsAvailable && (
        <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Konfigurasi credential production tetap dinonaktifkan dan memerlukan persetujuan aktivasi backend terpisah.
        </p>
      )}
      <div style={{ marginBottom: '1rem', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)' }}>
        <h4 style={{ margin: '0 0 0.5rem 0' }}>Preferensi Smart Multi-AI</h4>
        <p style={{ margin: '0 0 0.75rem 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Preferensi ini tidak menyimpan prompt, dokumen, credential, atau persetujuan pengiriman data.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' }}>
          <label className="form-group" style={{ margin: 0 }}>
            <span>Mode default</span>
            <select
              className="form-input"
              value={preferenceDraft.mode}
              onChange={event => setPreferenceDraft(current => ({ ...current, mode: event.target.value }))}
            >
              <option value="automatic">Otomatis — Rekomendasi UniMate</option>
              <option value="manual">Manual — Pilih sendiri</option>
            </select>
          </label>
          <label className="form-group" style={{ margin: 0 }}>
            <span>Kebutuhan default</span>
            <select
              className="form-input"
              value={preferenceDraft.complexity}
              onChange={event => setPreferenceDraft(current => ({ ...current, complexity: event.target.value }))}
            >
              <option value="light">Ringan</option>
              <option value="medium">Sedang</option>
              <option value="heavy">Berat</option>
            </select>
          </label>
          <label className="form-group" style={{ margin: 0 }}>
            <span>Model default</span>
            <select
              className="form-input"
              value={preferenceDraft.modelId}
              onChange={event => setPreferenceDraft(current => ({ ...current, modelId: event.target.value }))}
            >
              {AI_PREFERENCE_MODELS.map(model => (
                <option key={model.modelId} value={model.modelId} disabled={!model.selectable}>
                  {model.label}{model.selectable ? '' : ' — belum tersedia'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={preferenceDraft.preferFreeTier} disabled readOnly />
          Gunakan hanya model Free Tier yang diizinkan backend
        </label>
        <p style={{ margin: '0.75rem 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          <strong>Kuota lokal:</strong>{' '}
          {preferenceStatus?.quota
            ? `${preferenceStatus.quota.locallyObserved.requestsToday}/${preferenceStatus.quota.limits.requestsPerDay} request hari ini (bukan kuota Google real-time)`
            : 'belum tersedia'}
        </p>
        {preferenceStatus?.storage === 'corrupt' && (
          <p style={{ margin: '0 0 0.75rem 0', color: '#b45309', fontSize: '0.8rem' }}>
            File preferensi terdeteksi rusak dan tidak akan ditimpa otomatis.
          </p>
        )}
        <button
          className="btn btn-primary"
          disabled={preferencePending || preferenceStatus?.storage === 'corrupt'}
          onClick={submitPreferences}
        >
          {preferencePending ? 'Menyimpan...' : 'Simpan Preferensi AI'}
        </button>
      </div>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {CREDENTIAL_PROVIDERS.map(provider => {
          const state = credentialStatus?.providers?.[provider.id] || 'tidak tersedia';
          const configured = state === 'configured';
          const pending = pendingProvider === provider.id;
          const providerMutationAvailable = client.canMutate(provider.id);
          return (
            <div key={provider.id} style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)' }}>
              <div style={{ marginBottom: '0.6rem', color: 'var(--text-main)', fontSize: '0.9rem' }}>
                <strong>{provider.label}</strong>: {state}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  type="password"
                  autoComplete="off"
                  className="form-input"
                  aria-label={`Credential ${provider.label}`}
                  placeholder={configured ? `Ganti credential ${provider.label}` : `Tambah credential ${provider.label}`}
                  value={drafts[provider.id]}
                  disabled={!providerMutationAvailable || pending}
                  onChange={event => setDrafts(current => ({ ...current, [provider.id]: event.target.value }))}
                  style={{ flex: '1 1 260px' }}
                />
                <button className="btn btn-primary" disabled={!providerMutationAvailable || pending || drafts[provider.id].length === 0} onClick={() => submitCredential(provider.id)}>
                  {configured ? 'Ganti' : 'Tambah'}
                </button>
                <button className="btn btn-outline" disabled={pending || drafts[provider.id].length === 0} onClick={() => clearDraft(provider.id)}>
                  Batal
                </button>
                <button className="btn btn-outline" disabled={!providerMutationAvailable || pending || !configured} onClick={() => removeCredential(provider.id)}>
                  Hapus
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
        <h4 style={{ margin: '0 0 0.5rem 0' }}>Batas Estimasi Biaya AI</h4>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Budget guard bersifat fail-closed. Estimasi UniMate bersifat konservatif dan bukan jaminan batas tagihan provider.
        </p>
        <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--text-main)' }}>
          <strong>Status:</strong> {budgetStatus?.configured ? 'dikonfigurasi' : 'belum dikonfigurasi'} ·{' '}
          <strong>Harian:</strong> {budgetStatus?.configured ? `${formatAIBudgetMicrousd(budgetStatus.dailyUsedMicrousd)} / ${formatAIBudgetMicrousd(budgetStatus.dailyLimitMicrousd)}` : 'belum tersedia'} ·{' '}
          <strong>Bulanan:</strong> {budgetStatus?.configured ? `${formatAIBudgetMicrousd(budgetStatus.monthlyUsedMicrousd)} / ${formatAIBudgetMicrousd(budgetStatus.monthlyLimitMicrousd)}` : 'belum tersedia'}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="number"
            min="0.000001"
            max="1000"
            step="0.000001"
            className="form-input"
            aria-label="Batas anggaran harian AI dalam USD"
            placeholder="Batas harian (USD)"
            value={budgetDraft.daily}
            disabled={!budgetMutationsAvailable || budgetPending}
            onChange={event => setBudgetDraft(current => ({ ...current, daily: event.target.value }))}
            style={{ flex: '1 1 220px' }}
          />
          <input
            type="number"
            min="0.000001"
            max="1000"
            step="0.000001"
            className="form-input"
            aria-label="Batas anggaran bulanan AI dalam USD"
            placeholder="Batas bulanan (USD)"
            value={budgetDraft.monthly}
            disabled={!budgetMutationsAvailable || budgetPending}
            onChange={event => setBudgetDraft(current => ({ ...current, monthly: event.target.value }))}
            style={{ flex: '1 1 220px' }}
          />
          <button
            className="btn btn-primary"
            disabled={!budgetMutationsAvailable || budgetPending || budgetDraft.daily.length === 0 || budgetDraft.monthly.length === 0}
            onClick={submitBudget}
          >
            {budgetStatus?.configured ? 'Ganti Batas' : 'Simpan Batas'}
          </button>
        </div>
        {!budgetMutationsAvailable && (
          <p style={{ margin: '0.75rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Perubahan budget production tetap dinonaktifkan sampai aktivasi backend disetujui.
          </p>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const { githubUser, setGithubUser, isHoliday, setIsHoliday } = useAppContext();
  const [githubInputValue, setGithubInputValue] = useState(githubUser);

  const handleSaveGithub = () => {
    setGithubUser(githubInputValue);
    toast.success('Username GitHub berhasil disimpan!');
  };

  const toggleHolidayMode = (e) => {
    const checked = e.target.checked;
    setIsHoliday(checked);
    window.dispatchEvent(new Event('storage'));
    toast.success(checked ? 'Mode Libur Diaktifkan!' : 'Mode Libur Dimatikan');
  };

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
      el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
      el.style.boxShadow = '0 0 0 4px rgba(139, 92, 246, 0.3)';
      el.style.borderColor = 'var(--primary-color)';
      setTimeout(() => {
        el.style.boxShadow = '';
        el.style.borderColor = 'var(--border-color)';
      }, 1500);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <h1 className="page-title">Pengaturan</h1>
        <p className="page-subtitle">Sesuaikan konfigurasi AI dan preferensi aplikasi Anda.</p>
      </div>

      <div className="profile-layout">
        
        {/* Sidebar Menu */}
        <div className="profile-sidebar-sticky">
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 1rem 0' }}>Menu Pengaturan</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <li 
                onClick={() => scrollToSection('section-ai')} 
                style={{ cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: '8px' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              ><Key size={18} style={{ color: '#8b5cf6' }}/> Konfigurasi AI</li>
              
              <li 
                onClick={() => scrollToSection('section-holiday')} 
                style={{ cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: '8px' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              ><span style={{ fontSize: '1.1rem' }}>🌴</span> Mode Libur</li>
              
              <li 
                onClick={() => scrollToSection('section-github')} 
                style={{ cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: '8px' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              ><GitBranch size={18} style={{ color: 'var(--text-main)' }}/> Integrasi GitHub</li>
              
              <li 
                onClick={() => scrollToSection('section-backup')} 
                style={{ cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: '8px' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              ><Database size={18} style={{ color: '#10b981' }}/> Pencadangan Data</li>
            </ul>
          </div>
        </div>

        {/* Form Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Konfigurasi AI */}
          <CredentialSettingsSection />

          {/* Mode Libur */}
          <div id="section-holiday" className="glass-card" tabIndex="-1" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', border: '1px solid var(--border-color)', outline: 'none', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '1.2rem' }}>🌴</span>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Mode Libur Semester</h3>
              </div>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Nonaktifkan jadwal kelas harian dan kosongkan area dashboard.
              </p>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px', flexShrink: 0 }}>
              <input type="checkbox" style={{ opacity: 0, width: 0, height: 0 }} 
                checked={isHoliday}
                onChange={toggleHolidayMode}
              />
              <span style={{ 
                position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, 
                backgroundColor: isHoliday ? '#10b981' : 'var(--border-color)', 
                transition: '.4s', borderRadius: '34px',
                display: 'flex', alignItems: 'center'
              }}>
                <span style={{
                  position: 'absolute', height: '18px', width: '18px', left: isHoliday ? '28px' : '4px',
                  bottom: '3px', backgroundColor: '#fff', transition: '.4s', borderRadius: '50%',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}></span>
              </span>
            </label>
          </div>

          {/* Konfigurasi GitHub */}
          <div id="section-github" className="glass-card" tabIndex="-1" style={{ display: 'flex', flexDirection: 'column', padding: '1.5rem', border: '1px solid var(--border-color)', outline: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <GitBranch size={20} style={{ color: 'var(--text-main)' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Integrasi GitHub</h3>
            </div>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Masukkan username publik GitHub Anda untuk menarik daftar repositori secara instan ke Project Workspace.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Username GitHub (misal: octocat)" 
                value={githubInputValue} 
                onChange={(e) => setGithubInputValue(e.target.value)} 
                style={{ flex: '1 1 300px' }}
              />
              <button className="btn btn-primary" onClick={handleSaveGithub} style={{ backgroundColor: 'var(--text-main)', color: 'var(--card-bg)', borderColor: 'var(--text-main)', whiteSpace: 'nowrap', flex: '0 0 auto' }}>
                <Save size={18} /> Simpan User
              </button>
            </div>
          </div>

          {/* Pencadangan Data */}
          <div id="section-backup" className="glass-card" tabIndex="-1" style={{ display: 'flex', flexDirection: 'column', padding: '1.5rem', border: '1px solid var(--border-color)', outline: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <Database size={20} style={{ color: '#10b981' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Pencadangan Data</h3>
            </div>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Ekspor seluruh data akademik Anda ke format JSON, atau pulihkan data dari file cadangan sebelumnya.
            </p>
            <DataBackup />
          </div>

        </div>
      </div>
    </div>
  );
}
