import { useEffect, useId, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import {
  AI_COMPLEXITY_LEVELS,
  AI_SELECTION_MODES,
} from '../../shared/ai/contracts.mjs';
import {
  AI_DEFAULT_MODEL_ID,
  getAIModel,
} from '../../shared/ai/modelCatalog.mjs';
import {
  listCompatibleAIModels,
  recommendAIModel,
} from '../../shared/ai/modelRecommendation.mjs';
import { createDefaultAISelection } from '../services/aiClient';
import { aiPreferenceClient } from '../services/aiPreferenceClient';
import './AIModelSelector.css';

const COMPLEXITY_OPTIONS = Object.freeze([
  Object.freeze({ value: AI_COMPLEXITY_LEVELS.LIGHT, label: 'Ringan', detail: 'Pertanyaan dan rangkuman singkat' }),
  Object.freeze({ value: AI_COMPLEXITY_LEVELS.MEDIUM, label: 'Sedang', detail: 'Tugas atau analisis lebih detail' }),
  Object.freeze({ value: AI_COMPLEXITY_LEVELS.HEAVY, label: 'Berat', detail: 'Instruksi panjang dan analisis kompleks' }),
]);

export function useAISelection(initialConsent = false) {
  const [selection, setSelection] = useState(() => createDefaultAISelection({
    freeTierDataConsent: initialConsent,
  }));
  const [preferenceStatus, setPreferenceStatus] = useState(null);

  useEffect(() => {
    let active = true;
    void aiPreferenceClient.getStatus().then(status => {
      if (!active) return;
      setPreferenceStatus(status);
      setSelection(current => createDefaultAISelection({
        mode: status.preferences.mode,
        complexity: status.preferences.complexity,
        modelId: status.preferences.modelId,
        freeTierDataConsent: current.freeTierDataConsent,
      }));
    }).catch(() => {
      if (active) setPreferenceStatus(null);
    });
    return () => { active = false; };
  }, []);

  return Object.freeze({ selection, setSelection, preferenceStatus });
}

function quotaSummary(status) {
  const quota = status?.quota;
  if (!quota) return 'Status kuota lokal tersedia saat UniMate berjalan melalui Electron.';
  return `Penggunaan lokal hari ini ${quota.locallyObserved.requestsToday}/${quota.limits.requestsPerDay} request. Bukan sisa kuota Google secara real-time.`;
}

export default function AIModelSelector({
  capability,
  input,
  selection,
  onChange,
  preferenceStatus = null,
  compact = false,
  requireConsent = false,
}) {
  const instanceId = useId().replaceAll(':', '');
  const models = useMemo(
    () => listCompatibleAIModels(capability, input),
    [capability, input],
  );
  const recommendation = useMemo(() => {
    try {
      return recommendAIModel({
        capability,
        input,
        mode: selection.mode,
        complexity: selection.mode === AI_SELECTION_MODES.MANUAL ? selection.complexity : null,
        requestedModelId: selection.mode === AI_SELECTION_MODES.MANUAL ? selection.modelId : null,
      });
    } catch {
      return null;
    }
  }, [capability, input, selection.complexity, selection.mode, selection.modelId]);

  useEffect(() => {
    if (
      selection.mode === AI_SELECTION_MODES.AUTOMATIC
      && recommendation
      && (
        selection.complexity !== recommendation.complexity
        || selection.modelId !== recommendation.modelId
      )
    ) {
      onChange({
        ...selection,
        complexity: recommendation.complexity,
        modelId: recommendation.modelId,
      });
    }
  }, [onChange, recommendation, selection]);

  const activeModel = getAIModel(recommendation?.modelId ?? selection.modelId);
  const quota = preferenceStatus?.quota;
  const quotaWarning = quota !== null && quota !== undefined && (
    quota.locallyObserved.requestsToday >= Math.floor(quota.limits.requestsPerDay * 0.8)
    || quota.locallyObserved.requestsThisMinute >= Math.floor(quota.limits.requestsPerMinute * 0.8)
    || quota.locallyObserved.inputTokensThisMinute >= Math.floor(quota.limits.inputTokensPerMinute * 0.8)
  );

  const update = patch => onChange({ ...selection, ...patch });

  return (
    <section className={`ai-model-selector${compact ? ' ai-model-selector--compact' : ''}`} aria-label="Pemilihan model AI">
      <div className="ai-model-selector__heading">
        <div>
          <span className="ai-model-selector__eyebrow"><Sparkles size={14} /> Smart Model Selector</span>
          <strong>{activeModel?.label ?? 'Model belum tersedia'}</strong>
        </div>
        <span className="ai-model-selector__free-badge">Gemini Free Tier</span>
      </div>

      <fieldset className="ai-model-selector__fieldset">
        <legend>Mode pemilihan</legend>
        <div className="ai-model-selector__segmented">
          <button
            type="button"
            aria-pressed={selection.mode === AI_SELECTION_MODES.AUTOMATIC}
            className={selection.mode === AI_SELECTION_MODES.AUTOMATIC ? 'is-active' : ''}
            onClick={() => update({ mode: AI_SELECTION_MODES.AUTOMATIC, modelId: AI_DEFAULT_MODEL_ID })}
          >
            Otomatis
          </button>
          <button
            type="button"
            aria-pressed={selection.mode === AI_SELECTION_MODES.MANUAL}
            className={selection.mode === AI_SELECTION_MODES.MANUAL ? 'is-active' : ''}
            onClick={() => update({ mode: AI_SELECTION_MODES.MANUAL })}
          >
            Pilih Sendiri
          </button>
        </div>
      </fieldset>

      <fieldset className="ai-model-selector__fieldset">
        <legend>Kebutuhan</legend>
        <div className="ai-model-selector__complexity">
          {COMPLEXITY_OPTIONS.map(option => (
            <label key={option.value} className={selection.complexity === option.value ? 'is-active' : ''}>
              <input
                type="radio"
                name={`ai-complexity-${instanceId}`}
                value={option.value}
                checked={selection.complexity === option.value}
                disabled={selection.mode === AI_SELECTION_MODES.AUTOMATIC}
                onChange={() => update({ complexity: option.value })}
              />
              <span>{option.label}</span>
              {!compact && <small>{option.detail}</small>}
            </label>
          ))}
        </div>
      </fieldset>

      {selection.mode === AI_SELECTION_MODES.MANUAL && (
        <div className="ai-model-selector__field">
          <label htmlFor={`ai-model-${instanceId}`}>Model</label>
          <select
            id={`ai-model-${instanceId}`}
            value={selection.modelId}
            onChange={event => update({ modelId: event.target.value })}
          >
            {models.map(model => (
              <option key={model.modelId} value={model.modelId} disabled={!model.selectable}>
                {model.label}{model.selectable ? '' : ' — belum tersedia'}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="ai-model-selector__reason" role="status">
        <Info size={15} />
        <span>{recommendation?.reason ?? 'Pilih input yang didukung agar UniMate dapat merekomendasikan model.'}</span>
      </div>

      <div className={`ai-model-selector__quota${quotaWarning ? ' is-warning' : ''}`}>
        {quotaWarning ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
        <span>{quotaSummary(preferenceStatus)}</span>
      </div>

      <p className="ai-model-selector__privacy">
        Konten diproses melalui Gemini Free Tier. Kuota lokal bersifat konservatif dan konten dapat tunduk pada kebijakan penggunaan data Google.
      </p>

      {requireConsent && (
        <label className="ai-model-selector__consent">
          <input
            type="checkbox"
            checked={selection.freeTierDataConsent}
            onChange={event => update({ freeTierDataConsent: event.target.checked })}
          />
          <span>Saya setuju mengirim input ini ke Gemini Free Tier untuk permintaan ini.</span>
        </label>
      )}
    </section>
  );
}
