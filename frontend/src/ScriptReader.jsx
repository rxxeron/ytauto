import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { ArrowLeft, FileText, Download } from 'lucide-react';

export default function ScriptReader({ episodeId, onBack }) {
  const [episode, setEpisode] = useState(null);

  useEffect(() => {
    fetchEpisode();
  }, [episodeId]);

  const fetchEpisode = async () => {
    const { data } = await supabase.from('episodes').select('*').eq('id', episodeId).single();
    if (data) setEpisode(data);
  };

  if (!episode) {
    return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading Script...</div>;
  }

  const handleDownload = () => {
    const element = document.createElement("a");
    const file = new Blob([episode.final_script_content], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `${episode.title.replace(/\s+/g, '_')}_Script.txt`;
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();
  };

  const handleGeneratePrompts = async () => {
    if (confirm("Are you sure you want to AI-generate Video and Audio prompts from this script?")) {
      await supabase.from('episodes').update({ status: 'generating_prompts' }).eq('id', episodeId);
      window.dispatchEvent(new CustomEvent('openEpisode', { detail: { ...episode, status: 'generating_prompts' } }));
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '80vh' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onBack} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
            <ArrowLeft size={16} /> Back to Series
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FileText color="var(--accent-primary)" /> 
              Final Script: {episode.title}
            </h2>
            <p style={{ margin: 0, color: '#34d399', fontSize: '14px', fontWeight: '500' }}>Approved for Production</p>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={handleDownload} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={16} /> Download .txt
          </button>
          <button onClick={handleGeneratePrompts} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            Breakdown into Scenes (Video/Audio)
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', padding: '40px', background: 'white', color: 'black', borderRadius: '12px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', fontFamily: 'Courier New, Courier, monospace', fontSize: '15px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
          {episode.final_script_content}
        </div>
      </div>
    </div>
  );
}
