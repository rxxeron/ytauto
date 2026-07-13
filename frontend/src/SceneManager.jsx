import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { ArrowLeft, Video, Mic, Loader2 } from 'lucide-react';

export default function SceneManager({ episodeId, onBack }) {
  const [episode, setEpisode] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [characters, setCharacters] = useState({});
  const [loading, setLoading] = useState(true);
  const [uploadingSceneId, setUploadingSceneId] = useState(null);
  
  // Track which scene is currently being edited
  const [editingPromptId, setEditingPromptId] = useState(null);
  const [editPromptValue, setEditPromptValue] = useState("");

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [episodeId]);

  const fetchData = async () => {
    const { data: ep } = await supabase.from('episodes').select('*').eq('id', episodeId).single();
    if (ep) setEpisode(ep);

    const { data: sc } = await supabase.from('episode_scenes').select('*').eq('episode_id', episodeId).order('scene_number', { ascending: true });
    if (sc) setScenes(sc);

    if (ep && ep.season_id) {
      const { data: season } = await supabase.from('seasons').select('series_id').eq('id', ep.season_id).single();
      if (season && season.series_id) {
        const { data: chars } = await supabase.from('characters').select('*').eq('series_id', season.series_id);
        if (chars) {
          const charMap = {};
          chars.forEach(c => charMap[c.name.toLowerCase()] = c);
          setCharacters(charMap);
        }
      }
    }
    
    setLoading(false);
  };

  if (loading || !episode) return <div>Loading...</div>;

  if (episode.status === 'generating_prompts') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column' }}>
        <Loader2 className="spin" size={48} color="var(--accent-primary)" />
        <h2 style={{ marginTop: '24px' }}>AI is analyzing the script...</h2>
        <p style={{ color: 'var(--text-muted)' }}>Breaking it down into video and audio prompts for you.</p>
      </div>
    );
  }

  const handleGenerateMasterAudio = async () => {
    await supabase.from('episodes').update({ status: 'generating_audio' }).eq('id', episodeId);
    fetchData(); // Optimistic update
  };

  const handleGenerateAudio = async (sceneId) => {
    await supabase.from('episode_scenes').update({ status: 'generating_audio' }).eq('id', sceneId);
    fetchData(); // Optimistic update
  };

  const handleGenerateVideo = async (sceneId) => {
    await supabase.from('episode_scenes').update({ status: 'generating_video' }).eq('id', sceneId);
    fetchData(); // Optimistic update
  };
  
  const handleRegeneratePrompt = async (sceneId) => {
    await supabase.from('episode_scenes').update({ status: 'regenerating_prompt' }).eq('id', sceneId);
    fetchData();
  };

  const handleUploadVideo = async (sceneId, file) => {
    if (!file) return;
    setUploadingSceneId(sceneId);
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${sceneId}_${Date.now()}.${fileExt}`;
    const filePath = `scene_renders/${fileName}`;
    
    try {
      const { error: uploadError } = await supabase.storage.from('videos').upload(filePath, file);
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage.from('videos').getPublicUrl(filePath);
      
      await supabase.from('episode_scenes').update({ video_url: publicUrl, status: 'completed' }).eq('id', sceneId);
      fetchData();
    } catch (error) {
      console.error('Error uploading video:', error);
      alert('Failed to upload video.');
    } finally {
      setUploadingSceneId(null);
    }
  };

  const handleSavePrompt = async (sceneId) => {
    await supabase.from('episode_scenes').update({ visual_prompt: editPromptValue }).eq('id', sceneId);
    setEditingPromptId(null);
    fetchData();
  };

  const handleRegenerateAllScenes = async () => {
    if (confirm("Are you sure you want to trash all current scenes? The AI will read the script and generate a brand new set of scenes.")) {
      await supabase.from('episode_scenes').delete().eq('episode_id', episodeId);
      await supabase.from('episodes').update({ status: 'generating_prompts' }).eq('id', episodeId);
      fetchData();
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '80vh' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onBack} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '24px' }}>
              Asset Generation: {episode.title}
            </h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>Automated API Integration for Wan 2.6 and ElevenLabs</p>
          </div>
        </div>
        <button onClick={handleRegenerateAllScenes} className="btn-secondary" style={{ color: '#ef4444', borderColor: '#ef4444' }}>
          Trash & Regenerate Scenes
        </button>
      </div>

      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '12px', marginBottom: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Video size={18} /> Cinematic Rendering (Wan 2.6)
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Wan 2.6 handles native Audio & Video generation simultaneously.</p>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {scenes.map(scene => (
          <div key={scene.id} className="glass-panel" style={{ padding: '24px', display: 'flex', gap: '24px' }}>
            
            {/* Scene Info */}
            <div style={{ flex: '0 0 80px', textAlign: 'center', borderRight: '1px solid var(--border-light)', paddingRight: '24px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Scene</div>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: 'var(--accent-primary)' }}>{scene.scene_number}</div>
            </div>

            {/* Video Prompt (Wan 2.6) */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#60a5fa', fontWeight: '600' }}>
                  <Video size={18} /> Visual & Audio Generation (Wan 2.6)
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {scene.status !== 'regenerating_prompt' && (
                    <button 
                      onClick={() => handleRegeneratePrompt(scene.id)}
                      className="btn-secondary" 
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                    >
                      AI Rewrite
                    </button>
                  )}
                  {scene.visual_prompt && (
                    <button 
                      onClick={() => {
                        const text = `[VISUAL & AUDIO]: ${scene.visual_prompt}${scene.dialogue ? `\n[DIALOGUE TO SYNC]: "${scene.dialogue}"` : ""}`;
                        navigator.clipboard.writeText(text);
                        alert("Prompt copied to clipboard!");
                      }}
                      className="btn-secondary" 
                      style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      Copy Prompt
                    </button>
                  )}
                </div>
              </div>
              
              {editingPromptId === scene.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <textarea 
                    value={editPromptValue}
                    onChange={(e) => setEditPromptValue(e.target.value)}
                    style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid #60a5fa', padding: '12px', borderRadius: '8px', color: 'white', fontSize: '14px', width: '100%', minHeight: '100px', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button className="btn-secondary" onClick={() => setEditingPromptId(null)} style={{ padding: '6px 12px', fontSize: '12px' }}>Cancel</button>
                    <button className="btn-primary" onClick={() => handleSavePrompt(scene.id)} style={{ padding: '6px 12px', fontSize: '12px' }}>Save Prompt</button>
                  </div>
                </div>
              ) : (
                <div 
                  onClick={() => { setEditingPromptId(scene.id); setEditPromptValue(scene.visual_prompt || ""); }}
                  style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px', fontSize: '14px', lineHeight: '1.6', color: 'var(--text-secondary)', cursor: 'pointer', border: '1px solid transparent' }}
                  onMouseEnter={(e) => e.currentTarget.style.border = '1px dashed rgba(255,255,255,0.2)'}
                  onMouseLeave={(e) => e.currentTarget.style.border = '1px solid transparent'}
                  title="Click to edit prompt manually"
                >
                  {scene.status === 'regenerating_prompt' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}><Loader2 className="spin" size={16} /> AI is rewriting visual prompt...</div>
                  ) : (
                    scene.visual_prompt || <em style={{opacity: 0.5}}>No visual description. Click to add one.</em>
                  )}
                </div>
              )}

              {scene.dialogue && (
                <div style={{ background: 'rgba(52, 211, 153, 0.05)', border: '1px solid rgba(52, 211, 153, 0.2)', padding: '12px 16px', borderRadius: '8px', fontSize: '14px' }}>
                  <div style={{ color: '#34d399', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px', fontWeight: 'bold' }}>{scene.character_name} ({scene.emotion_tag || 'neutral'})</div>
                  <div style={{ fontStyle: 'italic', color: 'white' }}>"{scene.dialogue}"</div>
                </div>
              )}

              {(() => {
                if (!scene.character_name) return null;
                const searchName = scene.character_name.toLowerCase();
                let matchedChar = characters[searchName];
                
                // Fuzzy fallback if exact match fails (e.g. "Elara" matching "Elara (Young Mother)")
                if (!matchedChar) {
                  const possibleMatch = Object.values(characters).find(c => c.name.toLowerCase().includes(searchName) || searchName.includes(c.name.toLowerCase().split(' ')[0]));
                  if (possibleMatch) matchedChar = possibleMatch;
                }
                
                if (!matchedChar) return null;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Image-to-Video Reference Angles</div>
                        <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{matchedChar.name}</div>
                      </div>
                      <button 
                        onClick={() => {
                          const links = `Front: ${matchedChar.view_front_url}\nLeft: ${matchedChar.view_left_url}\nRight: ${matchedChar.view_right_url}\nBack: ${matchedChar.view_back_url}`;
                          navigator.clipboard.writeText(links);
                          alert("All 4 image links copied to clipboard!");
                        }}
                        className="btn-secondary"
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                      >
                        Copy All Links
                      </button>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
                      {[
                        { label: 'Front', url: matchedChar.view_front_url },
                        { label: 'Left Profile', url: matchedChar.view_left_url },
                        { label: 'Right Profile', url: matchedChar.view_right_url },
                        { label: 'Back', url: matchedChar.view_back_url }
                      ].map((angle, idx) => angle.url && (
                        <div key={idx} style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <img 
                            src={angle.url} 
                            alt={`${matchedChar.name} ${angle.label}`} 
                            style={{ width: '64px', height: '64px', borderRadius: '8px', objectFit: 'cover' }} 
                          />
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{angle.label}</div>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(angle.url);
                              alert(`${angle.label} image link copied!`);
                            }}
                            className="btn-secondary"
                            style={{ fontSize: '10px', padding: '4px 8px', width: '100%' }}
                          >
                            Copy Link
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div>
                {scene.video_url ? (
                  <video controls src={scene.video_url} style={{ width: '100%', borderRadius: '8px', background: 'black' }} />
                ) : uploadingSceneId === scene.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-muted)', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                    <Loader2 className="spin" size={16} /> Uploading Video...
                  </div>
                ) : (
                  <div style={{ position: 'relative', width: '100%' }}>
                    <input 
                      type="file" 
                      accept="video/mp4,video/webm"
                      onChange={(e) => handleUploadVideo(scene.id, e.target.files[0])}
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                    />
                    <button className="btn-secondary" style={{ width: '100%', padding: '10px', borderColor: '#60a5fa', color: '#60a5fa', pointerEvents: 'none' }}>
                      Upload Rendered Clip (MP4)
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>
        ))}
        {scenes.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>
            No scenes found.
          </div>
        )}
      </div>
    </div>
  );
}
