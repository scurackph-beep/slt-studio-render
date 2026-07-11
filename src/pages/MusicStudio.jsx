import { useState } from 'react';

export default function MusicStudio() {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleSynthesize = () => {
    setIsGenerating(true);
    setTimeout(() => setIsGenerating(false), 3000); 
  };

  return (
    <div style={styles.studioLayout}>
      {/* PANEL IZQUIERDO: FORMULARIO */}
      <div style={styles.controlPanel}>
        <h2 style={styles.title}>MUSIC / <span style={{color: '#666'}}>SYNTHESIS</span></h2>
        <p style={styles.subtitle}>Void-Audio Engine (v1.0)</p>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>// INSTRUCCIÓN (PROMPT)</label>
          <textarea style={styles.textarea} placeholder="Ej: Canción acústica vulnerable, cruda, tipo Damien Rice..."></textarea>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>// ESTILO & INSTRUMENTOS</label>
          <input style={styles.input} type="text" placeholder="Guitarra acústica, voz rota, sin dolor..." />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>// LETRA (VACÍO = AUTO-GENERADA)</label>
          <textarea style={styles.textareaLarge} placeholder="[Verse 1]&#10;Everything is white..."></textarea>
        </div>

        <button 
          style={isGenerating ? styles.buttonGenerating : styles.button} 
          onClick={handleSynthesize}
          disabled={isGenerating}
        >
          {isGenerating ? '[ SINTETIZANDO FRECUENCIAS... ]' : '[ INICIAR SÍNTESIS ]'}
        </button>
      </div>

      {/* PANEL DERECHO: CASCADA HOLOGRÁFICA (RESULTADOS) */}
      <div style={styles.feedPanel}>
        <div style={styles.feedHeader}>
          <span style={styles.feedTitle}>RENDER QUEUE</span>
          <span style={styles.statusLive}>● LIVE API</span>
        </div>

        {/* Tarjeta de Canción (Holograma) */}
        <div style={styles.trackCard}>
          <div style={styles.trackInfo}>
            <h4 style={{margin: 0, fontWeight: 'normal'}}>Sweet_Trauma_Acoustic.wav</h4>
            <span style={{fontSize: '0.7rem', color: '#888'}}>03:12 / Raw Acoustic</span>
          </div>
          <div style={styles.waveformPlaceholder}>
            ||||| || | |||| ||| | || |||| | ||| || ||||
          </div>
          <div style={styles.trackActions}>
            <button style={styles.actionBtn}>▶ PLAY</button>
            <button style={styles.actionBtn}>SPLIT STEMS</button>
          </div>
        </div>

      </div>
    </div>
  );
}

const styles = {
  studioLayout: { display: 'flex', height: '100%', gap: '2rem', padding: '1rem', width: '100%' },
  controlPanel: { width: '35%', display: 'flex', flexDirection: 'column', gap: '1.5rem', borderRight: '1px solid rgba(255,255,255,0.05)', paddingRight: '2rem' },
  title: { margin: 0, fontSize: '1.5rem', letterSpacing: '1px' },
  subtitle: { margin: 0, color: '#555', fontSize: '0.8rem', textTransform: 'uppercase' },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontSize: '0.7rem', color: '#888', letterSpacing: '1px' },
  input: { backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '0.8rem', fontFamily: 'monospace', borderRadius: '4px', outline: 'none' },
  textarea: { backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '0.8rem', fontFamily: 'monospace', minHeight: '80px', borderRadius: '4px', outline: 'none', resize: 'none' },
  textareaLarge: { backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '0.8rem', fontFamily: 'monospace', minHeight: '150px', borderRadius: '4px', outline: 'none', resize: 'none' },
  button: { backgroundColor: '#fff', color: '#000', border: 'none', padding: '1rem', fontFamily: 'monospace', fontWeight: 'bold', cursor: 'pointer', marginTop: 'auto', transition: 'all 0.2s', borderRadius: '4px' },
  buttonGenerating: { backgroundColor: '#333', color: '#0f0', border: '1px solid #0f0', padding: '1rem', fontFamily: 'monospace', fontWeight: 'bold', marginTop: 'auto', borderRadius: '4px' },
  
  feedPanel: { width: '65%', display: 'flex', flexDirection: 'column', gap: '1rem' },
  feedHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' },
  feedTitle: { fontSize: '0.8rem', color: '#666', letterSpacing: '1px' },
  statusLive: { fontSize: '0.7rem', color: '#0f0', letterSpacing: '1px', animation: 'blink 2s infinite' },
  trackCard: { backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '1rem' },
  trackInfo: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  waveformPlaceholder: { color: '#444', fontSize: '1.5rem', letterSpacing: '2px', overflow: 'hidden', whiteSpace: 'nowrap' },
  trackActions: { display: 'flex', gap: '1rem' },
  actionBtn: { backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '0.5rem 1rem', fontFamily: 'monospace', fontSize: '0.7rem', cursor: 'pointer', transition: 'background 0.2s' }
};