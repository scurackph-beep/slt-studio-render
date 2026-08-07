import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCharacter,
  createCharacterVersion,
  fetchCharacter,
  fetchCharacters,
  linkCharacterAsset,
  setCharacterConsent,
  uploadReferenceAsset,
} from '../lib/api-client';
import './CharacterLab.css';

const STAGES = [
  { id: 'face_angles', label: 'Face angles', category: 'identity_photo' },
  { id: 'expressions', label: 'Expressions', category: 'expression_photo' },
  { id: 'body', label: 'Body and wardrobe', category: 'body_photo' },
  { id: 'performance_video', label: 'Performance video', category: 'performance_video' },
  { id: 'voice', label: 'Voice calibration', category: 'voice_sample' },
];

function uploadKind(file) {
  if (file.type?.startsWith('video/')) return 'video';
  if (file.type?.startsWith('audio/')) return 'sound';
  return 'image';
}

function requirementRows(requirements = {}) {
  return Object.entries(requirements)
    .filter(([, value]) => typeof value === 'object')
    .map(([key, value]) => ({ key, ...value }));
}

export default function CharacterLab() {
  const [characters, setCharacters] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [active, setActive] = useState(null);
  const [name, setName] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [commercialUse, setCommercialUse] = useState(false);
  const [stage, setStage] = useState(STAGES[0].id);
  const [angle, setAngle] = useState('');
  const [expression, setExpression] = useState('');
  const [status, setStatus] = useState('Ready.');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });

  const selectedStage = useMemo(() => STAGES.find((item) => item.id === stage) || STAGES[0], [stage]);
  const requirements = requirementRows(active?.requirements);

  const loadCharacter = useCallback(async (characterId) => {
    if (!characterId) {
      setActive(null);
      return;
    }
    const result = await fetchCharacter(characterId);
    if (!result.ok) {
      setStatus(result.message || 'Character could not be loaded.');
      return;
    }
    setActive(result.data);
    setSubjectName(result.data?.character?.name || '');
    setStatus(result.data?.ready ? 'Dataset meets the recommended capture coverage.' : 'Dataset collection in progress.');
  }, []);

  const loadCharacters = useCallback(async (preferredId = '') => {
    const result = await fetchCharacters();
    if (!result.ok) {
      setStatus(result.message || 'Character library unavailable.');
      return;
    }
    const items = result.data?.characters || [];
    setCharacters(items);
    const nextId = preferredId || activeId || items[0]?.id || '';
    setActiveId(nextId);
    if (nextId) await loadCharacter(nextId);
  }, [activeId, loadCharacter]);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const result = await createCharacter({ name: name.trim() });
    setBusy(false);
    if (!result.ok) {
      setStatus(result.message || 'Character could not be created.');
      return;
    }
    setName('');
    setStatus('Character created. Grant consent before adding identity media.');
    await loadCharacters(result.data.character.id);
  };

  const handleConsent = async () => {
    if (!activeId || !subjectName.trim()) return;
    setBusy(true);
    const result = await setCharacterConsent(activeId, {
      status: 'granted',
      subjectName: subjectName.trim(),
      scope: { likeness: true, voice: true, training: true, commercialUse },
    });
    setBusy(false);
    if (!result.ok) {
      setStatus(result.message || 'Consent could not be recorded.');
      return;
    }
    setStatus('Consent recorded with dataset scope.');
    await loadCharacter(activeId);
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !activeId) return;
    if (!active?.consentGranted) {
      setStatus('Grant explicit subject consent before uploading identity media.');
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: files.length, failed: 0 });
    setStatus(`Uploading ${files.length} source file${files.length === 1 ? '' : 's'}...`);
    let cursor = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const index = cursor;
        cursor += 1;
        const file = files[index];
        const upload = await uploadReferenceAsset({
          file,
          kind: uploadKind(file),
          module: 'character',
          role: selectedStage.label,
          note: active.character.name,
        });
        if (!upload.ok || !upload.data?.asset) {
          failed += 1;
          setProgress((current) => ({ ...current, done: current.done + 1, failed }));
          continue;
        }
        const linked = await linkCharacterAsset(activeId, {
          assetId: upload.data.asset.id,
          category: selectedStage.category,
          captureStage: selectedStage.id,
          angle: angle.trim(),
          expression: expression.trim(),
        });
        if (!linked.ok) failed += 1;
        setProgress((current) => ({ ...current, done: current.done + 1, failed }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
    setBusy(false);
    setStatus(failed ? `${files.length - failed}/${files.length} files added. Review the failed items.` : `${files.length} files added to the character dataset.`);
    await loadCharacter(activeId);
  };

  const handleVersion = async () => {
    if (!activeId) return;
    setBusy(true);
    const result = await createCharacterVersion(activeId);
    setBusy(false);
    if (!result.ok) {
      setStatus(result.message || 'Dataset version could not be created.');
      return;
    }
    setStatus(`Dataset version ${result.data.version.version} saved. No provider training was started.`);
    await loadCharacter(activeId);
  };

  return (
    <div className="character-lab studio-container">
      <header className="character-lab-header">
        <div>
          <p className="studio-rail-label">Identity system</p>
          <h1 className="studio-main-title">Character Lab</h1>
          <p className="studio-main-meta">High-fidelity visual, motion and voice datasets with explicit consent and versioned capture coverage.</p>
        </div>
        <p className="character-lab-status" aria-live="polite">{status}</p>
      </header>

      <div className="character-lab-shell">
        <aside className="character-lab-list">
          <div className="character-lab-create">
            <label className="studio-field">
              <span>New character</span>
              <input className="studio-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Character name" />
            </label>
            <button type="button" className="studio-button" onClick={handleCreate} disabled={busy || !name.trim()}>Create</button>
          </div>
          <nav aria-label="Characters">
            {characters.map((character) => (
              <button
                type="button"
                key={character.id}
                className={`character-lab-character ${character.id === activeId ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveId(character.id);
                  loadCharacter(character.id);
                }}
              >
                <strong>{character.name}</strong>
                <span>{character.ready ? 'Capture ready' : 'Collecting'}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="character-lab-main">
          {!active ? (
            <section className="character-lab-empty">
              <h2>Create the first character</h2>
              <p>The dataset may contain dozens or thousands of assets. SLT does not impose an artificial 50-photo ceiling.</p>
            </section>
          ) : (
            <>
              <section className="character-lab-identity">
                <div>
                  <p className="studio-rail-label">Active character</p>
                  <h2>{active.character.name}</h2>
                  <p>{active.counts.total} linked assets · {active.versions.length} dataset versions</p>
                </div>
                <button type="button" className="studio-action" onClick={handleVersion} disabled={busy || !active.consentGranted}>
                  [ Save dataset version ]
                </button>
              </section>

              <section className="character-lab-consent" aria-labelledby="character-consent-title">
                <div>
                  <p className="studio-rail-label" id="character-consent-title">Consent gate</p>
                  <p>{active.consentGranted ? 'Granted' : 'Required before biometric media can be linked.'}</p>
                </div>
                <label className="studio-field">
                  <span>Subject name</span>
                  <input className="studio-input" value={subjectName} onChange={(event) => setSubjectName(event.target.value)} />
                </label>
                <label className="character-lab-check">
                  <input type="checkbox" checked={commercialUse} onChange={(event) => setCommercialUse(event.target.checked)} />
                  Commercial-use permission
                </label>
                <button type="button" className="studio-button" onClick={handleConsent} disabled={busy || !subjectName.trim()}>Grant consent</button>
              </section>

              <section className="character-lab-coverage">
                <div className="character-lab-section-head">
                  <div>
                    <p className="studio-rail-label">Capture coverage</p>
                    <p>Recommended baseline for consistency. More diverse, high-quality sources improve fidelity.</p>
                  </div>
                  <strong>{active.ready ? 'READY' : 'IN PROGRESS'}</strong>
                </div>
                <div className="character-lab-meters">
                  {requirements.map((requirement) => (
                    <div key={requirement.key} className="character-lab-meter">
                      <span>{requirement.key}</span>
                      <strong>{requirement.current}/{requirement.recommended}</strong>
                      <progress value={Math.min(requirement.current, requirement.recommended)} max={requirement.recommended} />
                    </div>
                  ))}
                </div>
              </section>

              <section className="character-lab-upload">
                <div className="character-lab-section-head">
                  <div>
                    <p className="studio-rail-label">Dataset intake</p>
                    <p>Batch upload photos, performance videos and voice calibration. Three files transfer concurrently.</p>
                  </div>
                  {progress.total ? <strong>{progress.done}/{progress.total}</strong> : null}
                </div>
                <div className="character-lab-fields">
                  <label className="studio-field">
                    <span>Capture stage</span>
                    <select className="studio-select" value={stage} onChange={(event) => setStage(event.target.value)}>
                      {STAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="studio-field">
                    <span>Angle</span>
                    <input className="studio-input" value={angle} onChange={(event) => setAngle(event.target.value)} placeholder="front, profile-left..." />
                  </label>
                  <label className="studio-field">
                    <span>Expression</span>
                    <input className="studio-input" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="neutral, laugh, fear..." />
                  </label>
                </div>
                <label className={`character-lab-drop ${busy ? 'is-busy' : ''}`}>
                  <input
                    type="file"
                    multiple
                    disabled={busy || !active.consentGranted}
                    accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/ogg,audio/mp4"
                    onChange={(event) => handleFiles(event.target.files)}
                  />
                  <strong>{busy ? 'Uploading dataset...' : 'Choose or drop a batch'}</strong>
                  <span>Photos, MP4/MOV/WebM and voice recordings. Selection size is not capped by the UI.</span>
                </label>
              </section>

              <section className="character-lab-plan">
                <p className="studio-rail-label">Directed capture plan</p>
                {(active.capturePlan || []).map((item) => (
                  <article key={item.stage}>
                    <header><strong>{item.label}</strong><span>{item.recommended} recommended</span></header>
                    <p>{item.instructions.join(' · ')}</p>
                  </article>
                ))}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
