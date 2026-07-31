import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Play, ArrowLeft, Loader2, PlayCircle, Image as ImageIcon, Download, Check, Save, Volume2 } from 'lucide-react';

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
  const [portionPage, setPortionPage] = useState(0);

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
  const [searchQuery, setSearchQuery] = useState('');
  
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

  const chunkSize = 4;
  const portions = [];
  for (let i = 0; i < scenes.length; i += chunkSize) {
    portions.push(scenes.slice(i, i + chunkSize));
  }
  const totalPortionPages = Math.ceil(portions.length / 5);
  const visiblePortions = portions.slice(portionPage * 5, (portionPage + 1) * 5);

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

        {/* Compile Full Stitched Movie Button */}
        <button 
          className="btn-primary" 
          style={{ padding: '10px 20px', fontWeight: 'bold', background: '#6366f1', borderColor: '#6366f1', display: 'flex', alignItems: 'center', gap: '8px' }}
          onClick={async () => {
            await supabase.from('reels').update({ status: 'compiling_video', final_video_url: null }).eq('id', reelId);
            setReel({...reel, status: 'compiling_video', final_video_url: null});
          }}
        >
          🎬 Compile & Export Final Video
        </button>

        {['audio_ready', 'completed', 'error'].includes(reel.status) && (
          <div style={{ display: 'flex', gap: '12px' }}>
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
          
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
            <input 
              type="text" 
              placeholder="Search YouTube for BGM (e.g. 1 hour sleep music)" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchQuery) {
                  supabase.from('reels').update({ status: 'bgm_searching', error_message: searchQuery }).eq('id', reel.id).then(fetchData);
                }
              }}
            />
            <button 
              className="btn-primary" 
              onClick={async () => {
                if (searchQuery) {
                  await supabase.from('reels').update({ status: 'bgm_searching', error_message: searchQuery }).eq('id', reel.id);
                  fetchData();
                }
              }}
            >
              Search
            </button>
          </div>
          
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PlayCircle /> Master Audio Track
          </h3>
          <button 
            className="btn-secondary" 
            style={{ padding: '6px 12px', fontSize: '13px' }}
            onClick={async () => {
              await supabase.from('reels').update({ status: 'generating_audio' }).eq('id', reel.id);
              fetchData();
            }}
            disabled={reel.status === 'generating_audio'}
          >
            {reel.status === 'generating_audio' ? 'Mixing...' : 'Force Regenerate'}
          </button>
        </div>
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
        ) : reel.status === 'error_audio' ? (
          <div style={{ padding: '20px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: '#ef4444' }}>
              <p style={{ margin: 0, fontWeight: 500 }}>Master Audio Track Generation Failed</p>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', opacity: 0.8 }}>The AI orchestrator encountered an error while mixing. The corrupted audio chunks have likely been flagged.</p>
            </div>
            <button 
              className="btn-primary" 
              style={{ background: '#ef4444', borderColor: '#ef4444' }}
              onClick={async () => {
                await supabase.from('reels').update({ status: 'generating_audio' }).eq('id', reel.id);
                fetchData();
              }}
            >
              Retry Mixdown
            </button>
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
          Portion-Based Audio Breakdown ({portions.length} Portions)
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

      {totalPortionPages > 1 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {Array.from({ length: totalPortionPages }).map((_, pIdx) => (
            <button
              key={pIdx}
              onClick={() => setPortionPage(pIdx)}
              className={portionPage === pIdx ? "btn-primary" : "btn-secondary"}
              style={{ padding: '6px 14px', fontSize: '13px', borderRadius: '8px' }}
            >
              Portions {pIdx * 5 + 1}–{Math.min((pIdx + 1) * 5, portions.length)}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
          visiblePortions.map((portion, vIdx) => {
            const portionIndex = portionPage * 5 + vIdx;
            const scenesCount = portion.length;
            const isPortionRegenerating = portion.some(s => s.status === 'regenerating_audio');

            return (
              <div key={portionIndex} className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Volume2 color="#8b5cf6" size={20} /> Portion {portionIndex + 1}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px' }}>
                      Covers {scenesCount} audio scenes
                    </span>
                    <button
                      className="btn-primary"
                      onClick={async () => {
                        for (const scene of portion) {
                          if (scene.dialogue && scene.dialogue.trim().length > 0) {
                            await supabase.from('reel_scenes').update({ status: 'regenerating_audio' }).eq('id', scene.id);
                          }
                        }
                        fetchData();
                      }}
                      style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap', background: '#8b5cf6', borderColor: '#8b5cf6' }}
                      disabled={isPortionRegenerating}
                    >
                      {isPortionRegenerating ? 'Generating Audio...' : portion.some(s => s.audio_url) ? 'Regenerate Audio for Portion' : 'Generate Audio for Portion'}
                    </button>
                  </div>
                </div>

                {/* Script & Voice controls inside this Portion */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {portion.map((scene) => (
                    <div key={scene.id} style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
                          Scene #{scene.scene_number} ({scene.character_name || 'Narrator'})
                        </span>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <select 
                            value={scene.voice || 'kokoro_af_bella'}
                            onChange={async (e) => {
                              await supabase.from('reel_scenes').update({ voice: e.target.value }).eq('id', scene.id);
                              fetchData();
                            }}
                            style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
                          >
                            <optgroup label="🇺🇸 American English">
                              <option value="kokoro_af_heart">af_heart (Female, S)</option>
                              <option value="kokoro_af_bella">af_bella (Female, A-)</option>
                              <option value="kokoro_af_nicole">af_nicole (Female, B)</option>
                              <option value="kokoro_af_sky">af_sky (Female, B-)</option>
                              <option value="kokoro_am_adam">am_adam (Male, D)</option>
                              <option value="kokoro_am_michael">am_michael (Male, B+)</option>
                            </optgroup>
                            <optgroup label="🇬🇧 British English">
                              <option value="kokoro_bf_emma">bf_emma (Female, B-)</option>
                              <option value="kokoro_bm_george">bm_george (Male, C)</option>
                            </optgroup>
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

                      <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: 'var(--text-muted)' }}>
                        "{scene.dialogue}"
                      </p>

                      {scene.audio_url && (
                        <audio controls src={scene.audio_url} style={{ width: '100%', height: '28px', opacity: 0.8, marginBottom: '8px' }} />
                      )}

                      {/* Visual Asset Preview & Query Context */}
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed rgba(255,255,255,0.1)', display: 'flex', gap: '16px', alignItems: 'center' }}>
                        {scene.video_url ? (
                          <div style={{ flex: '0 0 200px' }}>
                            <video src={scene.video_url} controls loop autoPlay muted style={{ width: '100%', height: '110px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-light)' }} />
                          </div>
                        ) : scene.image_url ? (
                          <div style={{ flex: '0 0 200px' }}>
                            <img src={scene.image_url} alt={`Scene ${scene.scene_number}`} style={{ width: '100%', height: '110px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-light)' }} />
                          </div>
                        ) : (
                          <div style={{ flex: '0 0 200px', height: '110px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
                            <ImageIcon size={20} style={{ marginBottom: '4px' }} />
                            <span>No Visual Asset Attached</span>
                          </div>
                        )}

                        <div style={{ flex: 1, fontSize: '12px' }}>
                          <div style={{ color: 'var(--text-muted)', marginBottom: '6px' }}>
                            <span style={{ fontWeight: 'bold' }}>Visual Search Query: </span>
                            <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '4px', color: '#38bdf8' }}>
                              {scene.search_query || scene.visual_prompt || 'Auto Context'}
                            </span>
                          </div>
                          
                          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            <button 
                              onClick={async () => {
                                await supabase.from('reel_scenes').update({ status: 'generating_video' }).eq('id', scene.id);
                                fetchData();
                              }}
                              className="btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '11px', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}
                            >
                              <ImageIcon size={12} style={{ display: 'inline', marginRight: '4px' }} />
                              Fetch Pixabay/Wikimedia
                            </button>

                            <button 
                              onClick={async () => {
                                await supabase.from('reel_scenes').update({ status: 'image_requested_local', visual_prompt_context: scene.dialogue }).eq('id', scene.id);
                                fetchData();
                              }}
                              className="btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '11px', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)' }}
                            >
                              ✨ FLUX AI Image
                            </button>

                            <button 
                              onClick={async () => {
                                await supabase.from('reel_scenes').update({ status: 'video_requested_local', visual_prompt_context: scene.dialogue }).eq('id', scene.id);
                                fetchData();
                              }}
                              className="btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '11px', color: '#8b5cf6', borderColor: 'rgba(139,92,246,0.3)' }}
                            >
                              🎬 Wan2.x AI Video
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* 4-5 Pixabay / Pexels / Coverr Media Options Picker */}
                      {Array.isArray(scene.media_options) && scene.media_options.length > 0 && (
                        <div style={{ marginTop: '12px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold' }}>
                            🎬 Select Stock Video Option ({scene.media_options.length} clips found from Pixabay/Pexels):
                          </div>
                          <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
                            {scene.media_options.map((optUrl, optIdx) => (
                              <div 
                                key={optIdx}
                                onClick={async () => {
                                  await supabase.from('reel_scenes').update({ video_url: optUrl, status: 'video_ready' }).eq('id', scene.id);
                                  fetchData();
                                }}
                                style={{ 
                                  flex: '0 0 120px', 
                                  cursor: 'pointer', 
                                  borderRadius: '6px', 
                                  overflow: 'hidden',
                                  border: scene.video_url === optUrl ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.2)',
                                  position: 'relative'
                                }}
                              >
                                <video src={optUrl} style={{ width: '120px', height: '70px', objectFit: 'cover' }} />
                                <div style={{ position: 'absolute', bottom: '4px', right: '4px', background: 'rgba(0,0,0,0.7)', fontSize: '9px', padding: '2px 4px', borderRadius: '3px', color: scene.video_url === optUrl ? '#10b981' : 'white' }}>
                                  {scene.video_url === optUrl ? '✓ Active' : `Option ${optIdx + 1}`}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
