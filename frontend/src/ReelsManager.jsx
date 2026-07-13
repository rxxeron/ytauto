import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Video, Plus, ArrowLeft, Download, CheckCircle, Circle, Tv, Camera, Trash2 } from 'lucide-react';

export default function ReelsManager() {
  const [reelsList, setReelsList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReels();
  }, []);

  const fetchReels = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('reels').select('*').order('created_at', { ascending: false });
    if (!error) setReelsList(data || []);
    setLoading(false);
  };

  const handleCreateReel = async () => {
    const title = prompt("Enter a topic for your Historical Short (e.g., 'The Fall of Rome'):");
    if (!title) return;
    
    const { data, error } = await supabase.from('reels').insert({ 
      title,
      status: 'draft',
      reel_type: 'standard'
    }).select().single();
    
    if (error) {
      alert("Error: " + error.message);
    } else {
      setReelsList([data, ...reelsList]);
      alert("Historical Reel created! Opening Director Chat...");
      window.dispatchEvent(new CustomEvent('openReel', { detail: data }));
    }
  };

  const handleCreateSleepStory = async () => {
    const title = prompt("Enter a topic for your Sleep Story (e.g., 'A Quiet Night in a Cabin'):");
    if (!title) return;
    
    const { data, error } = await supabase.from('reels').insert({ 
      title,
      status: 'draft',
      reel_type: 'sleep'
    }).select().single();
    
    if (error) {
      alert("Error: " + error.message);
    } else {
      setReelsList([data, ...reelsList]);
      alert("Sleeping Story created! Opening Director Chat...");
      window.dispatchEvent(new CustomEvent('openReel', { detail: data }));
    }
  };

  const handleDeleteReel = async (reelId) => {
    if (!window.confirm("Are you sure you want to permanently delete this reel?")) return;
    try {
      const { error } = await supabase.from('reels').delete().eq('id', reelId);
      if (error) throw error;
      setReelsList(reelsList.filter(r => r.id !== reelId));
    } catch (e) {
      alert("Error deleting reel: " + e.message);
    }
  };

  const togglePosting = async (reelId, platform, currentValue) => {
    const update = {};
    update[`posted_${platform}`] = !currentValue;
    
    // Optimistic update
    setReelsList(reelsList.map(r => r.id === reelId ? { ...r, ...update } : r));
    
    // DB update
    await supabase.from('reels').update(update).eq('id', reelId);
  };

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '32px', margin: '0 0 8px 0' }}>Shorts & Reels Studio</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Historical Documentaries & Short-form Content</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary" onClick={handleCreateReel}>
            + Create Historical Short
          </button>
          <button className="btn-secondary" onClick={handleCreateSleepStory} style={{ borderColor: '#6366f1', color: '#818cf8', background: 'rgba(99, 102, 241, 0.1)' }}>
            + Create Sleeping Story
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading reels...</p>
      ) : reelsList.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          No Reels found. Create a Historical Short to start!
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }} className="glass-panel">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '16px', fontWeight: '500' }}>Reel Topic</th>
              <th style={{ padding: '16px', fontWeight: '500' }}>Type</th>
              <th style={{ padding: '16px', fontWeight: '500' }}>Status</th>
              <th style={{ padding: '16px', fontWeight: '500' }}>Posting Status</th>
              <th style={{ padding: '16px', fontWeight: '500', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {reelsList.map(reel => (
              <tr key={reel.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '16px', fontWeight: '500' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(244, 63, 94, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f43f5e' }}>
                      <Video size={16} />
                    </div>
                    {reel.title}
                  </div>
                </td>
                <td style={{ padding: '16px', color: 'var(--text-muted)' }}>
                  {reel.reel_type === 'sleep' ? '🌙 Sleep Story' : '🎬 Historical'}
                </td>
                <td style={{ padding: '16px' }}>
                  <span style={{ 
                    background: reel.status === 'approved' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(255, 255, 255, 0.1)', 
                    color: reel.status === 'approved' ? '#34d399' : 'white', 
                    padding: '4px 10px', 
                    borderRadius: '99px', 
                    fontSize: '12px', 
                    textTransform: 'capitalize' 
                  }}>
                    {reel.status.replace('_', ' ')}
                  </span>
                </td>
                <td style={{ padding: '16px' }}>
                  {reel.status === 'completed' ? (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={() => togglePosting(reel.id, 'youtube', reel.posted_youtube)}
                        style={{ 
                          display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
                          background: reel.posted_youtube ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.05)',
                          color: reel.posted_youtube ? '#ef4444' : 'var(--text-muted)'
                        }}
                      >
                        <Tv size={14} /> YT
                      </button>
                      <button 
                        onClick={() => togglePosting(reel.id, 'tiktok', reel.posted_tiktok)}
                        style={{ 
                          display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
                          background: reel.posted_tiktok ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255,255,255,0.05)',
                          color: reel.posted_tiktok ? '#06b6d4' : 'var(--text-muted)'
                        }}
                      >
                        <Video size={14} /> TT
                      </button>
                      <button 
                        onClick={() => togglePosting(reel.id, 'instagram', reel.posted_instagram)}
                        style={{ 
                          display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
                          background: reel.posted_instagram ? 'rgba(217, 70, 239, 0.2)' : 'rgba(255,255,255,0.05)',
                          color: reel.posted_instagram ? '#d946ef' : 'var(--text-muted)'
                        }}
                      >
                        <Camera size={14} /> IG
                      </button>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>-</span>
                  )}
                </td>
                <td style={{ padding: '16px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  {reel.status === 'completed' && reel.final_video_url && (
                    <a 
                      href={reel.final_video_url} 
                      download={`Reel_${reel.id.substring(0, 8)}.${reel.reel_type === 'sleep' ? 'mp3' : 'mp4'}`}
                      className="btn-secondary" 
                      style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', color: '#10b981', borderColor: '#10b981', background: 'rgba(16, 185, 129, 0.1)' }}
                    >
                      <Download size={14} /> Download
                    </a>
                  )}
                  
                  <button className="btn-secondary" onClick={() => window.dispatchEvent(new CustomEvent('openReelChat', { detail: reel }))} style={{ padding: '6px 12px', fontSize: '12px' }}>
                    {reel.status === 'draft' ? 'Open Director Chat' : 'View Script'}
                  </button>
                  
                  {['approved', 'prompts_ready', 'generating_prompts', 'error_prompts', 'generating_audio', 'audio_ready', 'bgm_selection', 'applying_bgm', 'compiling_video', 'completed', 'error'].includes(reel.status) && (
                    <button className="btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('openReelAssets', { detail: reel }))} style={{ padding: '6px 12px', fontSize: '12px' }}>
                      View Assets & Final Video
                    </button>
                  )}
                  
                  <button className="btn-secondary" onClick={() => handleDeleteReel(reel.id)} title="Delete Reel" style={{ padding: '6px 10px', borderColor: 'rgba(239, 68, 68, 0.5)', color: '#ef4444' }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
