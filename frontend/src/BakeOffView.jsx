import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { ArrowLeft, Check, ChevronDown, ChevronUp } from 'lucide-react';

export default function BakeOffView({ episodeId, onBack }) {
  const [episode, setEpisode] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedDraftId, setExpandedDraftId] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchData();
  }, [episodeId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch episode details
      const { data: epData, error: epError } = await supabase
        .from('episodes')
        .select('*, series(*)')
        .eq('id', episodeId)
        .single();
      if (epError) throw epError;
      setEpisode(epData);

      // 2. Fetch all drafts for this episode
      const { data: draftsData, error: draftsError } = await supabase
        .from('script_drafts')
        .select('*')
        .eq('episode_id', episodeId)
        .order('created_at', { ascending: false });
      if (draftsError) throw draftsError;
      
      setDrafts(draftsData || []);
      if (draftsData && draftsData.length > 0) {
        setExpandedDraftId(draftsData[0].id); // Expand the first one by default
      }
    } catch (error) {
      console.error('Error fetching bake-off data:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptDraft = async (draft) => {
    if (!window.confirm(`Are you sure you want to accept the ${draft.ai_model.toUpperCase()} draft as the official script?`)) return;
    
    setProcessing(true);
    try {
      // 1. Mark this draft as selected
      await supabase
        .from('script_drafts')
        .update({ is_selected: true })
        .eq('id', draft.id);

      // 2. Update the episode with the final script and status
      await supabase
        .from('episodes')
        .update({ 
          final_script_content: draft.content,
          status: 'approved'
        })
        .eq('id', episodeId);
      
      alert('Draft accepted successfully!');
      onBack(); // Go back to dashboard
    } catch (error) {
      console.error('Error accepting draft:', error.message);
      alert('Error accepting draft');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <div style={{ padding: '40px', color: 'var(--text-secondary)' }}>Loading Bake-off drafts...</div>;
  if (!episode) return <div style={{ padding: '40px', color: 'red' }}>Episode not found.</div>;

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '60px' }}>
      <button 
        onClick={onBack} 
        className="btn-secondary" 
        style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '24px', padding: '6px 16px', fontSize: '13px' }}
      >
        <ArrowLeft size={16} /> Back to Dashboard
      </button>

      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', margin: '0 0 8px 0' }}>AI Bake-Off: {episode.title}</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          {episode.series?.title} | Status: <span style={{ color: '#fbbf24' }}>{episode.status}</span>
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {drafts.length === 0 ? (
          <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No drafts have been generated for this episode yet. Make sure the Python orchestrator is running.
          </div>
        ) : (
          drafts.map((draft) => (
            <div 
              key={draft.id} 
              className="glass-panel" 
              style={{ 
                overflow: 'hidden', 
                border: expandedDraftId === draft.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-light)' 
              }}
            >
              {/* Header / Accordion Toggle */}
              <div 
                onClick={() => setExpandedDraftId(expandedDraftId === draft.id ? null : draft.id)}
                style={{ 
                  padding: '20px 24px', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  background: expandedDraftId === draft.id ? 'rgba(99, 102, 241, 0.05)' : 'transparent'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ 
                    padding: '6px 12px', 
                    borderRadius: '6px', 
                    background: 'var(--code-bg)', 
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--mono)',
                    fontSize: '14px',
                    fontWeight: '600',
                    textTransform: 'uppercase'
                  }}>
                    {draft.ai_model}
                  </div>
                  {draft.is_selected && (
                    <span style={{ color: '#34d399', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Check size={14} /> Selected
                    </span>
                  )}
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  {expandedDraftId === draft.id ? <ChevronUp size={20} color="var(--text-muted)" /> : <ChevronDown size={20} color="var(--text-muted)" />}
                </div>
              </div>

              {/* Expanded Content */}
              {expandedDraftId === draft.id && (
                <div style={{ padding: '0 24px 24px 24px', borderTop: '1px solid var(--border-light)', paddingTop: '24px' }}>
                  <div style={{ 
                    background: 'rgba(0,0,0,0.3)', 
                    padding: '20px', 
                    borderRadius: '8px', 
                    fontFamily: 'var(--sans)',
                    fontSize: '15px',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '600px',
                    overflowY: 'auto',
                    marginBottom: '20px',
                    color: '#e5e7eb'
                  }}>
                    {draft.content}
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button 
                      className="btn-primary" 
                      onClick={(e) => { e.stopPropagation(); handleAcceptDraft(draft); }}
                      disabled={processing || episode.status === 'approved'}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px' }}
                    >
                      <Check size={18} /> 
                      {processing ? 'Processing...' : 'Accept This Draft'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
