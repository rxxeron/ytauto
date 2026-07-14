import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Play, ArrowLeft, Loader2, PlayCircle, Image as ImageIcon, Download, Check, Save } from 'lucide-react';


const getVideoId = (url) => {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtube.com')) {
      return urlObj.searchParams.get('v');
    } else if (urlObj.hostname.includes('youtu.be')) {
      return urlObj.pathname.slice(1);
    }
  } catch (e) { return null; }
  return null;
};

const parseStartTime = (timeStr) => {
  if (!timeStr) return 0;
  const parts = timeStr.toString().split(':');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }
  return parseInt(timeStr, 10) || 0;
};

export default function ReelAssetsView({ reelId, onBack }) {
  const [reel, setReel] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [loadingRegen, setLoadingRegen] = useState({});
  const [previewLoading, setPreviewLoading] = useState({});

  const handleVoicePreview = async (sceneId, voice) => {
    if (!voice) return;
    setPreviewLoading(prev => ({ ...prev, [sceneId]: true }));
    
    try {
      const { data, error } = await supabase.from('voice_preview_requests').insert({
        voice_name: voice,
        status: 'pending'
      }).select().single();
      
      if (error || !data) {
        alert('Failed to request preview');
        setPreviewLoading(prev => ({ ...prev, [sceneId]: false }));
        return;
      }
      
      const reqId = data.id;
      
      const poll = setInterval(async () => {
        const { data: pollData } = await supabase.from('voice_preview_requests').select('*').eq('id', reqId).single();
        if (pollData && pollData.status === 'completed') {
          clearInterval(poll);
          setPreviewLoading(prev => ({ ...prev, [sceneId]: false }));
          const audio = new Audio(pollData.preview_url);
          audio.play();
        } else if (pollData && pollData.status === 'error') {
          clearInterval(poll);
          setPreviewLoading(prev => ({ ...prev, [sceneId]: false }));
          alert('Failed to generate preview audio');
        }
      }, 1000);
    } catch (e) {
      console.error(e);
      setPreviewLoading(prev => ({ ...prev, [sceneId]: false }));
    }
  };

  const [selectedBgmUrl, setSelectedBgmUrl] = useState('');
  const [bgmVolume, setBgmVolume] = useState(-6);
  const [bgmStart, setBgmStart] = useState('00:00');
  
  const [isLivePreviewing, setIsLivePreviewing] = useState(false);
  const masterAudioRef = useRef(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [reelId]);

  const fetchData = async () => {
    const { data: reelData } = await supabase.from('reels').select('*').eq('id', reelId).single();
    if (reelData) setReel(reelData);
    
    const { data: scenesData } = await supabase.from('reel_scenes').select('*').eq('reel_id', reelId).order('scene_number', { ascending: true });
    if (scenesData) setScenes(scenesData);
    
    setLoading(false);
  };

  if (loading || !reel) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column' }}>
        <Loader2 className="spin" size={32} color="var(--accent-primary)" />
        <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Loading Reel Assets...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <button onClick={onBack} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: '24px' }}>Reel Assets: {reel.title}</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Status: <span style={{ textTransform: 'capitalize', color: 'var(--accent-primary)' }}>{reel.status.replace('_', ' ')}</span></p>
        </div>
        
        {reel.status === 'approved' && (
          <button 
            className="btn-primary" 
            style={{ padding: '10px 20px', fontWeight: 'bold' }}
            onClick={async () => {
              await supabase.from('reels').update({ status: 'generating_prompts' }).eq('id', reelId);
              setReel({...reel, status: 'generating_prompts'});
            }}
          >
            Generate Prompts & Voice
          </button>
        )}
        
        {reel.status === 'error_prompts' && (
          <button 
            className="btn-primary" 
            style={{ padding: '10px 20px', fontWeight: 'bold', background: '#ef4444', borderColor: '#ef4444' }}
            onClick={async () => {
              await supabase.from('reels').update({ status: 'generating_prompts' }).eq('id', reelId);
              setReel({...reel, status: 'generating_prompts'});
            }}
          >
            Retry Extraction (Error Occurred)
          </button>
        )}

        {reel.status === 'prompts_ready' && (
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              className="btn-secondary" 
              style={{ padding: '10px 20px', fontWeight: 'bold' }}
              onClick={async () => {
                if(window.confirm("Are you sure you want to completely re-chunk this script into new scenes? This will delete all current scene assets.")) {
                  await supabase.from('reels').update({ status: 'generating_prompts' }).eq('id', reelId);
                  setReel({...reel, status: 'generating_prompts'});
                }
              }}
            >
              Re-Chunk Script
            </button>
            <button 
              className="btn-primary" 
              style={{ padding: '10px 20px', fontWeight: 'bold' }}
              onClick={async () => {
                await supabase.from('reels').update({ status: 'generating_audio', master_audio_url: null }).eq('id', reelId);
                if (reel.reel_type !== 'sleep') {
                  await supabase.from('reel_scenes').update({ status: 'generating_video', image_url: null }).eq('reel_id', reelId);
                }
                setReel({...reel, status: 'generating_audio', master_audio_url: null});
                fetchData();
              }}
            >
              Fetch Assets & Audio
            </button>
          </div>
        )}

        {['audio_ready', 'completed', 'error'].includes(reel.status) && (
          <div style={{ display: 'flex', gap: '12px' }}>
            {reel.reel_type !== 'sleep' && (
              <button 
                className="btn-primary" 
                style={{ padding: '10px 20px', fontWeight: 'bold', background: '#10b981', borderColor: '#10b981' }}
                onClick={async () => {
                  await supabase.from('reels').update({ status: 'compiling_video', final_video_url: null }).eq('id', reelId);
                  setReel({...reel, status: 'compiling_video', final_video_url: null});
                }}
              >
                {reel.status === 'completed' ? 'Regenerate Final Mix' : 'Generate Final Mix'}
              </button>
            )}
            <button 
              className="btn-secondary" 
              style={{ padding: '10px 20px', fontWeight: 'bold', background: '#6366f1', borderColor: '#818cf8', color: 'white' }}
              onClick={async () => {
                await supabase.from('reels').update({ status: 'generating_audio', master_audio_url: null }).eq('id', reelId);
                setReel({...reel, status: 'generating_audio', master_audio_url: null});
                fetchData();
              }}
            >
              Regenerate Audio Only
            </button>
            <button 
              className="btn-secondary" 
              style={{ padding: '10px 20px', fontWeight: 'bold', background: '#374151', borderColor: '#4b5563' }}
              onClick={async () => {
                if (window.confirm("This will clear your current assets and fetch new ones. Proceed?")) {
                  await supabase.from('reels').update({ status: 'generating_audio', master_audio_url: null }).eq('id', reelId);
                  await supabase.from('reel_scenes').update({ status: 'generating_video', image_url: null }).eq('reel_id', reelId);
                  setReel({...reel, status: 'generating_audio', master_audio_url: null});
                  fetchData();
                }
              }}
            >
              Refetch All Assets
            </button>
          </div>
        )}
      </div>

      {reel.final_video_url && reel.status === 'completed' && (
        <div className="glass-panel" style={{ padding: '24px', marginBottom: '32px', border: '1px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PlayCircle /> Final Short Ready!
            </h3>
            <button 
              className="btn-secondary" 
              style={{ padding: '8px 16px', fontWeight: 'bold', background: '#374151', borderColor: '#4b5563', fontSize: '14px' }}
              onClick={async () => {
                if (window.confirm("This will clear your current assets and fetch new ones. Proceed?")) {
                  await supabase.from('reels').update({ status: 'generating_audio', master_audio_url: null }).eq('id', reelId);
                  await supabase.from('reel_scenes').update({ status: 'generating_video', image_url: null }).eq('reel_id', reelId);
                  setReel({...reel, status: 'generating_audio', master_audio_url: null});
                  fetchData();
                }
              }}
            >
              Refetch All Assets
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {reel.reel_type === 'sleep' ? (
              <audio 
                controls 
                src={reel.final_video_url} 
                style={{ width: '100%', maxWidth: '500px', borderRadius: '12px' }} 
              />
            ) : (
              <video 
                controls 
                src={reel.final_video_url} 
                style={{ maxHeight: '500px', borderRadius: '12px', border: '1px solid var(--border-light)' }} 
              />
            )}
          </div>
        </div>
      )}

      {reel.status === 'compiling_video' && (
        <div className="glass-panel" style={{ padding: '24px', marginBottom: '32px', textAlign: 'center' }}>
          <Loader2 className="spin" size={32} style={{ margin: '0 auto 12px auto', color: '#10b981' }} />
          <h3 style={{ margin: '0 0 8px 0', color: '#10b981' }}>Compiling Final Video...</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Stitching the audio and images together using FFmpeg.</p>
        </div>
      )}

      {reel.status === 'bgm_selection' && (
        <div className="glass-panel" style={{ padding: '24px', marginBottom: '32px', border: '1px solid #3b82f6' }}>
          <h3 style={{ margin: '0 0 16px 0', color: '#3b82f6' }}>🎵 Select Background Music</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
            The AI has generated the voiceover! Now choose a background track to set the mood.
          </p>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            {reel.bgm_options?.map((opt, i) => (
              <div 
                key={i} 
                onClick={() => setSelectedBgmUrl(opt.url)}
                style={{ 
                  padding: '16px', 
                  background: selectedBgmUrl === opt.url ? 'rgba(59, 130, 246, 0.2)' : 'rgba(0,0,0,0.3)', 
                  border: selectedBgmUrl === opt.url ? '2px solid #3b82f6' : '1px solid var(--border-light)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <h4 style={{ margin: '0 0 8px 0', fontSize: '15px' }}>{opt.title}</h4>
                <a href={opt.url} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: '#60a5fa', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                  Preview on YouTube ↗
                </a>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Custom YouTube URL (Optional)</label>
              <input 
                type="text" 
                placeholder="https://www.youtube.com/watch?v=..." 
                value={selectedBgmUrl} 
                onChange={(e) => setSelectedBgmUrl(e.target.value)}
                style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }}
              />
            </div>
            
            {getVideoId(selectedBgmUrl) && (
              <div style={{ marginTop: '8px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-light)', background: '#000', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 12px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Live BGM Preview</span>
                  <button 
                    className="btn-secondary"
                    onClick={() => {
                      if (masterAudioRef.current) {
                        setIsLivePreviewing(true);
                        masterAudioRef.current.currentTime = 0;
                        masterAudioRef.current.play();
                      }
                    }}
                    style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    title="Play voiceover concurrently to preview the final mix"
                  >
                    <Play size={14} /> Test Mix w/ Voice
                  </button>
                </div>
                <iframe 
                  width="100%" 
                  height="120" 
                  src={`https://www.youtube.com/embed/${getVideoId(selectedBgmUrl)}?start=${parseStartTime(bgmStart)}${isLivePreviewing ? '&autoplay=1' : ''}`} 
                  title="YouTube Preview" 
                  frameBorder="0" 
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                  allowFullScreen
                ></iframe>
              </div>
            )}
            
            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Start Time (MM:SS)</label>
                <input 
                  type="text" 
                  value={bgmStart} 
                  onChange={(e) => setBgmStart(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Volume Attenuation (dB)</label>
                <input 
                  type="number" 
                  value={bgmVolume} 
                  onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
                  style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }}
                />
              </div>
            </div>
          </div>

          <button 
            className="btn-primary"
            style={{ width: '100%', padding: '12px', marginTop: '24px', fontWeight: 'bold' }}
            disabled={!selectedBgmUrl}
            onClick={async () => {
              await supabase.from('reels').update({ 
                status: 'applying_bgm', 
                selected_bgm: selectedBgmUrl,
                bgm_volume: bgmVolume,
                bgm_start_time: bgmStart
              }).eq('id', reelId);
              setReel({...reel, status: 'applying_bgm'});
              fetchData();
            }}
          >
            Apply BGM & Master Audio
          </button>
        </div>
      )}

      {reel.status === 'applying_bgm' && (
        <div className="glass-panel" style={{ padding: '24px', marginBottom: '32px', textAlign: 'center' }}>
          <Loader2 className="spin" size={32} style={{ margin: '0 auto 12px auto', color: '#3b82f6' }} />
          <h3 style={{ margin: '0 0 8px 0', color: '#3b82f6' }}>Applying Background Music...</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Downloading track and mixing audio.</p>
        </div>
      )}

      <div className="glass-panel" style={{ padding: '24px', marginBottom: '32px' }}>
        <h3 style={{ margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PlayCircle /> Master Audio Track
        </h3>
        {reel.master_audio_url || reel.status === 'bgm_selection' ? (
          <audio 
            ref={masterAudioRef}
            controls 
            src={reel.master_audio_url || `/assets/audio/reel_${reelId}_voice.mp3`} 
            style={{ width: '100%' }} 
            onEnded={() => setIsLivePreviewing(false)}
            onPause={() => setIsLivePreviewing(false)}
          />
        ) : ['approved', 'prompts_ready', 'error_prompts'].includes(reel.status) ? (
          <div style={{ padding: '20px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', color: 'var(--text-muted)' }}>
            <p style={{ margin: 0 }}>Waiting to generate final audio mix...</p>
          </div>
        ) : (
          <div style={{ padding: '20px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Loader2 className="spin" size={20} />
            <p style={{ margin: 0 }}>The AI Orchestrator is mixing the master audio track...</p>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '20px' }}>
          {reel.reel_type === 'sleep' ? 'Audio Chunks Breakdown' : 'Scene Breakdown & Wikimedia Images'}
        </h3>
        <button 
          className="btn-secondary"
          onClick={async () => {
            for (const scene of scenes) {
              if (scene.dialogue && scene.dialogue.trim().length > 0) {
                await supabase.from('reel_scenes').update({ status: 'regenerating_audio' }).eq('id', scene.id);
              }
            }
            fetchData();
          }}
          style={{ padding: '6px 12px', fontSize: '13px' }}
          disabled={scenes.some(s => s.status === 'regenerating_audio')}
        >
          {scenes.some(s => s.status === 'regenerating_audio') ? 'Regenerating...' : 'Regenerate All Audio'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {scenes.length === 0 ? (
          reel.status === 'approved' ? (
            <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>Ready to extract scenes! Click the Start button above.</p>
            </div>
          ) : reel.status === 'error_prompts' ? (
            <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: '#ef4444' }}>
              <p>The Python Orchestrator crashed during generation! Click Retry above.</p>
            </div>
          ) : (
            <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Loader2 className="spin" size={24} style={{ margin: '0 auto 12px auto' }} />
              <p>Orchestrator is extracting search queries from the script...</p>
            </div>
          )
        ) : (
          scenes.map(scene => (
            <div key={scene.id} className="glass-panel" style={{ display: 'flex', gap: '24px', padding: '24px' }}>
              {reel.reel_type !== 'sleep' && (
                <div style={{ flex: '0 0 200px', opacity: scene.is_hidden ? 0.3 : 1, transition: 'opacity 0.2s' }}>
                  <div style={{ 
                    width: '200px', 
                    height: '200px', 
                    background: 'rgba(0,0,0,0.3)', 
                    borderRadius: '12px', 
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--border-light)'
                  }}>
                    {scene.image_url ? (
                      scene.image_url.match(/\.(mp4|webm|mov)$/i) ? (
                        <video src={scene.image_url} controls muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <img src={scene.image_url} alt="Wikimedia/Pixabay Asset" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )
                    ) : scene.status === 'pending' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)', gap: '8px' }}>
                        <span style={{ fontSize: '12px' }}>Waiting...</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)', gap: '8px' }}>
                        <Loader2 className="spin" size={24} />
                        <span style={{ fontSize: '12px' }}>Fetching image...</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Media Options Gallery */}
                  {scene.media_options && scene.media_options.length > 0 && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
                      {scene.media_options.map((opt, i) => (
                        <div 
                          key={i} 
                          onClick={async () => {
                            await supabase.from('reel_scenes').update({ image_url: opt }).eq('id', scene.id);
                            fetchData();
                          }}
                          style={{ 
                            width: '48px', height: '48px', background: 'rgba(0,0,0,0.5)', borderRadius: '6px', cursor: 'pointer', overflow: 'hidden',
                            border: scene.image_url === opt ? '2px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.1)',
                            flexShrink: 0
                          }}
                          title="Click to select this asset"
                        >
                          {opt.match(/\.(mp4|webm|mov)$/i) ? (
                            <video src={opt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <img src={opt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <h4 style={{ margin: 0, fontSize: '18px', color: scene.is_hidden ? 'var(--text-muted)' : 'var(--accent-primary)' }}>
                    Scene {scene.scene_number} {scene.is_hidden && '(Opted Out)'}
                  </h4>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', color: scene.is_hidden ? '#ef4444' : 'var(--text-muted)' }}>
                      <input 
                        type="checkbox" 
                        checked={scene.is_hidden || false} 
                        onChange={async (e) => {
                          await supabase.from('reel_scenes').update({ is_hidden: e.target.checked }).eq('id', scene.id);
                          fetchData();
                        }}
                      />
                      Opt-Out (Extend Prev Clip)
                    </label>
                    <span style={{ fontSize: '12px', color: scene.status === 'error' ? '#ef4444' : 'var(--text-muted)', background: scene.status === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>
                      Status: {scene.status}
                    </span>
                  </div>
                  {scene.status === 'error' && scene.error_message && (
                    <div style={{ marginTop: '12px', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', fontSize: '13px', fontFamily: 'monospace' }}>
                      <strong>Error:</strong> {scene.error_message}
                    </div>
                  )}
                </div>
                
                {reel.reel_type !== 'sleep' && (
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {/* Search Query */}
                    <div style={{ flex: 2, background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #3b82f6' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Search Query</p>
                        <button 
                          className="btn-secondary" 
                          style={{ padding: '4px 12px', fontSize: '12px', background: 'rgba(59, 130, 246, 0.2)', borderColor: '#3b82f6', color: '#60a5fa' }}
                          onClick={async () => {
                            await supabase.from('reel_scenes').update({ status: 'generating_video', image_url: null }).eq('id', scene.id);
                            fetchData();
                          }}
                        >
                          Refetch Asset
                        </button>
                      </div>
                      <input 
                        type="text" 
                        value={scene.search_query || ''} 
                        onChange={async (e) => {
                          await supabase.from('reel_scenes').update({ search_query: e.target.value }).eq('id', scene.id);
                          fetchData();
                        }}
                        style={{ 
                          width: '100%', 
                          background: 'transparent', 
                          border: 'none', 
                          color: '#e5e7eb', 
                          fontSize: '15px', 
                          outline: 'none',
                          borderBottom: '1px dashed rgba(255,255,255,0.2)',
                          paddingBottom: '4px'
                        }} 
                      />
                    </div>

                    {/* Trimming */}
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Video Trimming</p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Start Time (s)</label>
                          <input 
                            type="number" 
                            step="0.1"
                            min="0"
                            placeholder="0.0"
                            value={scene.trim_start !== undefined ? scene.trim_start : ''} 
                            onChange={async (e) => {
                              const val = e.target.value ? parseFloat(e.target.value) : 0;
                              await supabase.from('reel_scenes').update({ trim_start: val }).eq('id', scene.id);
                              fetchData();
                            }}
                            style={{ 
                              width: '100%', 
                              background: 'rgba(255,255,255,0.05)', 
                              border: '1px solid var(--border-light)', 
                              color: 'white', 
                              fontSize: '14px',
                              padding: '6px',
                              borderRadius: '4px',
                              outline: 'none'
                            }} 
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Duration (s)</label>
                          <input 
                            type="number" 
                            step="0.1"
                            min="0"
                            placeholder="Auto"
                            value={scene.trim_end !== undefined && scene.trim_end !== null ? scene.trim_end : ''} 
                            onChange={async (e) => {
                              const val = e.target.value ? parseFloat(e.target.value) : null;
                              await supabase.from('reel_scenes').update({ trim_end: val }).eq('id', scene.id);
                              fetchData();
                            }}
                            style={{ 
                              width: '100%', 
                              background: 'rgba(255,255,255,0.05)', 
                              border: '1px solid var(--border-light)', 
                              color: 'white', 
                              fontSize: '14px',
                              padding: '6px',
                              borderRadius: '4px',
                              outline: 'none'
                            }} 
                          />
                        </div>
                      </div>
                      <p style={{ margin: '6px 0 0 0', fontSize: '10px', color: 'var(--text-muted)' }}>
                        *Leave Duration blank to auto-sync perfectly with dialogue.
                      </p>
                    </div>
                  </div>
                )}

                {scene.dialogue && (
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <p style={{ margin: '0', fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Dialogue</p>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Voice:</span>
                        <select 
                          value={scene.voice || 'kokoro_af_bella'}
                          onChange={async (e) => {
                            await supabase.from('reel_scenes').update({ voice: e.target.value }).eq('id', scene.id);
                            fetchData();
                          }}
                          className="input-field"
                          style={{ 
                            background: '#1e1e2d', 
                            border: '1px solid var(--border-light)', 
                            color: 'white',
                            padding: '4px 8px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            maxWidth: '200px'
                          }}
                        >
                         <optgroup label="🇺🇸 American English">
                            <option value="kokoro_af_heart">af_heart (Female, A)</option>
                            <option value="kokoro_af_alloy">af_alloy (Female, C)</option>
                            <option value="kokoro_af_aoede">af_aoede (Female, C+)</option>
                            <option value="kokoro_af_bella">af_bella (Female, A-)</option>
                            <option value="kokoro_af_jessica">af_jessica (Female, D)</option>
                            <option value="kokoro_af_kore">af_kore (Female, C+)</option>
                            <option value="kokoro_af_nicole">af_nicole (Female, B-)</option>
                            <option value="kokoro_af_nova">af_nova (Female, C)</option>
                            <option value="kokoro_af_river">af_river (Female, D)</option>
                            <option value="kokoro_af_sarah">af_sarah (Female, C+)</option>
                            <option value="kokoro_af_sky">af_sky (Female, C-)</option>
                            <option value="kokoro_am_adam">am_adam (Male, F+)</option>
                            <option value="kokoro_am_echo">am_echo (Male, D)</option>
                            <option value="kokoro_am_eric">am_eric (Male, D)</option>
                            <option value="kokoro_am_fenrir">am_fenrir (Male, C+)</option>
                            <option value="kokoro_am_liam">am_liam (Male, D)</option>
                            <option value="kokoro_am_michael">am_michael (Male, C+)</option>
                            <option value="kokoro_am_onyx">am_onyx (Male, D)</option>
                            <option value="kokoro_am_puck">am_puck (Male, C+)</option>
                            <option value="kokoro_am_santa">am_santa (Male, D-)</option>
                        </optgroup>
                        <optgroup label="🇬🇧 British English">
                            <option value="kokoro_bf_alice">bf_alice (Female, D)</option>
                            <option value="kokoro_bf_emma">bf_emma (Female, B-)</option>
                            <option value="kokoro_bf_isabella">bf_isabella (Female, C)</option>
                            <option value="kokoro_bf_lily">bf_lily (Female, D)</option>
                            <option value="kokoro_bm_daniel">bm_daniel (Male, D)</option>
                            <option value="kokoro_bm_fable">bm_fable (Male, C)</option>
                            <option value="kokoro_bm_george">bm_george (Male, C)</option>
                            <option value="kokoro_bm_lewis">bm_lewis (Male, D+)</option>
                        </optgroup>
                        <optgroup label="🇪🇸 Spanish">
                            <option value="kokoro_ef_dora">ef_dora (Female)</option>
                            <option value="kokoro_em_alex">em_alex (Male)</option>
                            <option value="kokoro_em_santa">em_santa (Male)</option>
                        </optgroup>
                        <optgroup label="🇫🇷 French">
                            <option value="kokoro_ff_siwis">ff_siwis (Female, B-)</option>
                        </optgroup>
                        <optgroup label="🇮🇹 Italian">
                            <option value="kokoro_if_sara">if_sara (Female, C)</option>
                            <option value="kokoro_im_nicola">im_nicola (Male, C)</option>
                        </optgroup>
                        <optgroup label="🇧🇷 Brazilian Portuguese">
                            <option value="kokoro_pf_dora">pf_dora (Female)</option>
                            <option value="kokoro_pm_alex">pm_alex (Male)</option>
                            <option value="kokoro_pm_santa">pm_santa (Male)</option>
                        </optgroup>
                        <optgroup label="🇯🇵 Japanese">
                            <option value="kokoro_jf_alpha">jf_alpha (Female, C+)</option>
                            <option value="kokoro_jf_gongitsune">jf_gongitsune (Female, C)</option>
                            <option value="kokoro_jf_nezumi">jf_nezumi (Female, C-)</option>
                            <option value="kokoro_jf_tebukuro">jf_tebukuro (Female, C)</option>
                            <option value="kokoro_jm_kumo">jm_kumo (Male, C-)</option>
                        </optgroup>
                        <optgroup label="🇨🇳 Mandarin Chinese">
                            <option value="kokoro_zf_xiaobei">zf_xiaobei (Female, D)</option>
                            <option value="kokoro_zf_xiaoni">zf_xiaoni (Female, D)</option>
                            <option value="kokoro_zf_xiaoxiao">zf_xiaoxiao (Female, D)</option>
                            <option value="kokoro_zf_xiaoyi">zf_xiaoyi (Female, D)</option>
                            <option value="kokoro_zm_yunjian">zm_yunjian (Male, D)</option>
                            <option value="kokoro_zm_yunxi">zm_yunxi (Male, D)</option>
                            <option value="kokoro_zm_yunxia">zm_yunxia (Male, D)</option>
                            <option value="kokoro_zm_yunyang">zm_yunyang (Male, D)</option>
                        </optgroup>
                        <optgroup label="🇮🇳 Hindi">
                            <option value="kokoro_hf_alpha">hf_alpha (Female, C)</option>
                            <option value="kokoro_hf_beta">hf_beta (Female, C)</option>
                            <option value="kokoro_hm_omega">hm_omega (Male, C)</option>
                            <option value="kokoro_hm_psi">hm_psi (Male, C)</option>
                        </optgroup>
                        </select>
                        
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '12px' }}>Speed:</span>
                        <select 
                          value={scene.speed || 1.0}
                          onChange={async (e) => {
                            await supabase.from('reel_scenes').update({ speed: parseFloat(e.target.value) }).eq('id', scene.id);
                            fetchData();
                          }}
                          className="input-field"
                          style={{ 
                            background: '#1e1e2d', 
                            border: '1px solid var(--border-light)', 
                            color: 'white',
                            padding: '4px 8px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            maxWidth: '100px'
                          }}
                        >
                          <option value={0.7}>0.7x (Very Slow)</option>
                          <option value={0.85}>0.85x (Slow/Sleep)</option>
                          <option value={1.0}>1.0x (Normal)</option>
                          <option value={1.15}>1.15x (Fast)</option>
                          <option value={1.3}>1.3x (Very Fast)</option>
                          <option value={1.5}>1.5x (Speedreader)</option>
                        </select>
                        <button
                          onClick={() => handleVoicePreview(scene.id, scene.voice || 'kokoro_af_bella')}
                          disabled={previewLoading[scene.id]}
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Play size={12} />
                          {previewLoading[scene.id] ? 'Loading...' : 'Listen'}
                        </button>
                      </div>
                    </div>
                    <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--text-muted)', fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
                      <strong style={{ color: 'white', marginRight: '4px' }}>{scene.character_name}:</strong> 
                      "{scene.dialogue}"
                    </p>
                    
                    {scene.audio_url && (
                      <div style={{ marginTop: '8px' }}>
                        <audio controls src={scene.audio_url} style={{ width: '100%', height: '32px' }} />
                      </div>
                    )}
                    
                    <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      {scene.status === 'regenerating_audio' ? (
                        <button
                          className="btn-danger"
                          onClick={async () => {
                            await supabase.from('reel_scenes').update({ status: 'completed' }).eq('id', scene.id);
                            fetchData();
                          }}
                          style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap', background: 'rgba(255, 68, 68, 0.2)', color: '#ff4444', border: '1px solid #ff4444' }}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          className="btn-secondary"
                          onClick={async () => {
                            await supabase.from('reel_scenes').update({ status: 'regenerating_audio' }).eq('id', scene.id);
                            fetchData();
                          }}
                          style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}
                        >
                          {scene.audio_url ? 'Regenerate Audio' : 'Generate Audio'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
