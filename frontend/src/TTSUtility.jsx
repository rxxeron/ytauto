import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { FileText, FileUp, Mic, Play, Download, Loader2 } from 'lucide-react';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const VOICES = [
  // American Female
  { id: "kokoro_af_bella", label: "Bella (Female, Soft/Warm)" },
  { id: "kokoro_af_sarah", label: "Sarah (Female, Professional)" },
  { id: "kokoro_af_nicole", label: "Nicole (Female, Clear/Bright)" },
  { id: "kokoro_af_sky", label: "Sky (Female, Calm/Gentle)" },
  { id: "kokoro_af_alloy", label: "Alloy (Female, Friendly)" },
  { id: "kokoro_af_nova", label: "Nova (Female, Upbeat)" },
  { id: "kokoro_af_shimmer", label: "Shimmer (Female, Expressive)" },
  { id: "kokoro_af_heart", label: "Heart (Female, Caring)" },
  { id: "kokoro_af_aoede", label: "Aoede (Female, Storyteller)" },
  { id: "kokoro_af_kore", label: "Kore (Female, Dynamic)" },
  { id: "kokoro_af_jessica", label: "Jessica (Female, Direct)" },
  { id: "kokoro_af_river", label: "River (Female, Smooth)" },

  // American Male
  { id: "kokoro_am_adam", label: "Adam (Male, Deep/Clear)" },
  { id: "kokoro_am_michael", label: "Michael (Male, Confident)" },
  { id: "kokoro_am_puck", label: "Puck (Male, Energetic)" },
  { id: "kokoro_am_echo", label: "Echo (Male, Relaxed)" },
  { id: "kokoro_am_onyx", label: "Onyx (Male, Authoritative)" },
  { id: "kokoro_am_fable", label: "Fable (Male, Engaging)" },
  { id: "kokoro_am_fenrir", label: "Fenrir (Male, Bold)" },

  // British Female
  { id: "kokoro_bf_emma", label: "Emma (British Female, Elegant)" },
  { id: "kokoro_bf_isabella", label: "Isabella (British Female, Sweet)" },
  { id: "kokoro_bf_alice", label: "Alice (British Female, Crisp)" },
  { id: "kokoro_bf_lily", label: "Lily (British Female, Soft)" },

  // British Male
  { id: "kokoro_bm_george", label: "George (British Male, Formal)" },
  { id: "kokoro_bm_fable", label: "Fable UK (British Male, Warm)" },
  { id: "kokoro_bm_lewis", label: "Lewis (British Male, Casual)" },
  { id: "kokoro_bm_daniel", label: "Daniel (British Male, Articulate)" },

  // Other Options
  { id: "gemini-3.1-flash-tts-preview", label: "Gemini 3.1 Flash (Experimental)" }
];

export default function TTSUtility() {
  const [text, setText] = useState('');
  const [voiceId, setVoiceId] = useState('kokoro_af_bella');
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    fetchJobs();
    
    // Subscribe to realtime updates for TTS Jobs
    const channel = supabase
      .channel('tts_jobs_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tts_jobs' }, (payload) => {
        fetchJobs();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchJobs = async () => {
    const { data } = await supabase.from('tts_jobs').select('*').order('created_at', { ascending: false }).limit(20);
    if (data) setJobs(data);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    try {
      if (file.type === "text/plain") {
        const textStr = await file.text();
        setText(textStr);
      } else if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setText(result.value);
      } else if (file.type === "application/pdf") {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const strings = content.items.map(item => item.str);
          fullText += strings.join(' ') + '\n\n';
        }
        setText(fullText);
      } else {
        alert("Unsupported file type. Please use TXT, PDF, or DOCX.");
      }
    } catch (err) {
      console.error(err);
      alert("Error reading file: " + err.message);
    }
    setLoading(false);
  };

  const handleGenerate = async () => {
    if (!text.trim()) {
      alert("Please enter some text or upload a document first.");
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase.from('tts_jobs').insert([{
      text_content: text.trim(),
      voice_id: voiceId,
      status: 'pending',
      user_id: user?.id
    }]);

    if (error) {
      alert("Error queueing job: " + error.message);
    } else {
      setText(''); // clear text after submitting
    }
    setLoading(false);
  };

  return (
    <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '32px' }}>
      {/* Left Column: Input */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '32px', margin: '0 0 8px 0' }}>Universal TTS Studio</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Extract text from documents and generate speech instantly.</p>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'flex-end' }}>
            <label style={{ color: 'var(--text-secondary)', fontSize: '14px', fontWeight: '500' }}>Text Content</label>
            
            <div>
              <input type="file" id="docUpload" style={{ display: 'none' }} accept=".txt,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={handleFileUpload} />
              <label htmlFor="docUpload" className="btn-secondary" style={{ cursor: 'pointer', padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileUp size={16} /> Upload Document (PDF, Word, TXT)
              </label>
            </div>
          </div>

          <textarea 
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your script here, or upload a document to extract text automatically..."
            style={{ width: '100%', height: '300px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '16px', color: 'white', resize: 'vertical', fontSize: '15px', lineHeight: '1.5' }}
          />

          <div style={{ display: 'flex', gap: '16px', marginTop: '24px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>Voice Profile</label>
              <select 
                value={voiceId} 
                onChange={(e) => setVoiceId(e.target.value)}
                style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', outline: 'none' }}
              >
                {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>
            
            <button className="btn-primary" onClick={handleGenerate} disabled={loading || !text.trim()} style={{ height: '46px', alignSelf: 'flex-end', padding: '0 32px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {loading ? <Loader2 className="spin" size={18} /> : <Mic size={18} />}
              Generate Audio
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: History/Jobs */}
      <div>
        <h3 style={{ fontSize: '18px', margin: '0 0 16px 0', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>Recent Generations</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {jobs.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }}>
              No recent TTS jobs.
            </div>
          ) : jobs.map(job => (
            <div key={job.id} className="glass-panel" style={{ padding: '16px', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {new Date(job.created_at).toLocaleString()}
                </span>
                <span style={{ 
                  background: job.status === 'completed' ? 'rgba(52, 211, 153, 0.1)' : job.status === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(96, 165, 250, 0.1)',
                  color: job.status === 'completed' ? '#34d399' : job.status === 'error' ? '#ef4444' : '#60a5fa',
                  padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase'
                }}>
                  {job.status}
                </span>
              </div>
              
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: '12px' }}>
                {job.text_content}
              </p>
              
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                <Mic size={10} style={{ display: 'inline', marginRight: '4px' }} />
                {VOICES.find(v => v.id === job.voice_id)?.label || job.voice_id}
              </div>

              {job.status === 'completed' && job.audio_url && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <audio src={job.audio_url} controls style={{ height: '32px', flex: 1, filter: 'invert(1)', opacity: 0.8 }} />
                  <a href={job.audio_url} download={`TTS_${job.id.substring(0,8)}.mp3`} className="btn-secondary" style={{ padding: '6px', borderRadius: '8px' }} title="Download MP3">
                    <Download size={16} />
                  </a>
                </div>
              )}
              {job.status === 'pending' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                  <Loader2 className="spin" size={14} /> Generating in background...
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
