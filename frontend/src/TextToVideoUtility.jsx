import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Mic, Play, Download, Loader2, Video, Image as ImageIcon, Archive, FileText, Sparkles, CheckCircle, Clock, Trash2, RefreshCw, XCircle } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export default function TextToVideoUtility() {
  const [ttsJobs, setTtsJobs] = useState([]);
  const [sleepStories, setSleepStories] = useState([]);
  const [standardReels, setStandardReels] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null); // { type: 'tts' | 'sleep' | 'reel', data: any }
  const [sleepScenes, setSleepScenes] = useState([]); // Array of Portions: [ [s1, s2, s3, s4], [s5, s6, s7, s8], ... ]
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [portionSize, setPortionSize] = useState(4); // 4 = Portion-Based, 1 = Scene-Based
  const [viewFilter, setViewFilter] = useState('all'); // 'all' | 'images' | 'videos'
  
  const [portionPage, setPortionPage] = useState(0);

  useEffect(() => {
    setPortionPage(0);
  }, [selectedItem?.data?.id, portionSize]);

  useEffect(() => {
    fetchLists();
    const interval = setInterval(fetchLists, 3000);
    const sub1 = supabase.channel('vid_tts_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'tts_jobs' }, fetchLists).subscribe();
    const sub2 = supabase.channel('vid_reel_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'reels' }, fetchLists).subscribe();
    
    return () => {
      clearInterval(interval);
      supabase.removeChannel(sub1);
      supabase.removeChannel(sub2);
    };
  }, []);

  const selectedId = selectedItem?.data?.id;
  useEffect(() => {
    if ((selectedItem?.type === 'sleep' || selectedItem?.type === 'reel') && selectedId) {
      fetchSleepScenes(selectedId, portionSize);
      const interval = setInterval(() => fetchSleepScenes(selectedId, portionSize), 3000);
      
      const sub = supabase.channel(`vid_scene_${selectedId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reel_scenes', filter: `reel_id=eq.${selectedId}` }, () => {
          fetchSleepScenes(selectedId, portionSize);
        }).subscribe();
        
      return () => {
        clearInterval(interval);
        supabase.removeChannel(sub);
      };
    }
  }, [selectedId, portionSize]);

  const fetchLists = async () => {
    const [ttsRes, reelsRes] = await Promise.all([
      supabase.from('tts_jobs').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('reels').select('*').order('created_at', { ascending: false }).limit(40)
    ]);
    if (ttsRes.data) setTtsJobs(ttsRes.data);
    if (reelsRes.data) {
      setSleepStories(reelsRes.data.filter(r => r.reel_type === 'sleep'));
      setStandardReels(reelsRes.data.filter(r => r.reel_type !== 'sleep'));
      // Keep selectedItem fresh if currently inspecting a reel
      if (selectedItem?.type === 'sleep' || selectedItem?.type === 'reel') {
        const fresh = reelsRes.data.find(r => r.id === selectedItem.data.id);
        if (fresh) setSelectedItem({ type: fresh.reel_type === 'sleep' ? 'sleep' : 'reel', data: fresh });
      }
    }
  };

  const fetchSleepScenes = async (reelId, chunkSizeVal = portionSize) => {
    const { data } = await supabase.from('reel_scenes').select('*').eq('reel_id', reelId).order('scene_number', { ascending: true });
    if (data && data.length > 0) {
      const chunkSize = chunkSizeVal;
      const portions = [];
      for (let i = 0; i < data.length; i += chunkSize) {
        portions.push(data.slice(i, i + chunkSize));
      }
      setSleepScenes(portions);
    }
  };

  const handleTTSImageRequest = async (jobId) => {
    await supabase.from('tts_jobs').update({ status: 'image_requested_local', image_url: null }).eq('id', jobId);
  };
  const handleTTSVideoRequest = async (jobId) => {
    await supabase.from('tts_jobs').update({ status: 'video_requested_local', video_url: null }).eq('id', jobId);
  };

  const handlePortionImageRequest = async (portion) => {
    const leader = portion[0];
    const combinedDialogue = portion.map(s => s.dialogue).join(" ") + ` [AR: ${aspectRatio}]`;
    await supabase.from('reel_scenes').update({ 
      status: 'image_requested_local',
      visual_prompt_context: combinedDialogue,
      image_url: null
    }).eq('id', leader.id);
  };

  const handlePortionVideoRequest = async (portion, ignoreImage = false) => {
    const leader = portion[0];
    const combinedDialogue = portion.map(s => s.dialogue).join(" ") + ` [AR: ${aspectRatio}]`;
    const updateData = { 
      status: 'video_requested_local',
      visual_prompt_context: combinedDialogue,
      video_url: null
    };
    if (ignoreImage) {
      updateData.image_url = null; // Clear cached image to force Direct Text-to-Video
    }
    await supabase.from('reel_scenes').update(updateData).eq('id', leader.id);
  };

  const handleCancelPortionGeneration = async (portion) => {
    for (const sc of portion) {
      await supabase.from('reel_scenes').update({ status: 'pending' }).eq('id', sc.id);
    }
    if (selectedId) fetchSleepScenes(selectedId, portionSize);
  };

  const handleCancelAllActiveJobs = async () => {
    if (!selectedId) return;
    const { data: scenes } = await supabase.from('reel_scenes').select('id').eq('reel_id', selectedId);
    if (scenes) {
      const ids = scenes.map(s => s.id);
      await supabase.from('reel_scenes').update({ status: 'pending' }).in('id', ids);
    }
    await supabase.from('reels').update({ status: 'pending' }).eq('id', selectedId);
    fetchSleepScenes(selectedId, portionSize);
    fetchLists();
  };

  const handleDeletePortionImage = async (portion) => {
    for (const sc of portion) {
      await supabase.from('reel_scenes').update({ image_url: null, status: 'pending' }).eq('id', sc.id);
    }
    if (selectedId) fetchSleepScenes(selectedId, portionSize);
  };

  const handleDeletePortionVideo = async (portion) => {
    for (const sc of portion) {
      await supabase.from('reel_scenes').update({ video_url: null, status: 'pending' }).eq('id', sc.id);
    }
    if (selectedId) fetchSleepScenes(selectedId, portionSize);
  };

  const handleResetAllStoryAssets = async (type = 'all') => {
    if (!selectedId) return;
    if (!window.confirm(`Are you sure you want to delete ${type === 'all' ? 'ALL images and videos' : type} for this story?`)) return;

    const { data: scenes } = await supabase.from('reel_scenes').select('id').eq('reel_id', selectedId);
    if (!scenes) return;

    const ids = scenes.map(s => s.id);
    const updateData = { status: 'pending' };
    if (type === 'images' || type === 'all') updateData.image_url = null;
    if (type === 'videos' || type === 'all') updateData.video_url = null;

    await supabase.from('reel_scenes').update(updateData).in('id', ids);
    if (type === 'all' || type === 'videos') {
      await supabase.from('reels').update({ final_video_url: null, status: 'pending' }).eq('id', selectedId);
    }
    fetchSleepScenes(selectedId, portionSize);
    fetchLists();
  };

  const handleGenerateAllPortionImages = async () => {
    for (const portion of sleepScenes) {
      const leader = portion[0];
      const combinedDialogue = portion.map(s => s.dialogue).join(" ") + ` [AR: ${aspectRatio}]`;
      await supabase.from('reel_scenes').update({ 
        status: 'image_requested_local',
        visual_prompt_context: combinedDialogue,
        image_url: null
      }).eq('id', leader.id);
    }
  };

  const handleGenerateAllPortionVideos = async (ignoreImages = false) => {
    for (const portion of sleepScenes) {
      const leader = portion[0];
      const combinedDialogue = portion.map(s => s.dialogue).join(" ") + ` [AR: ${aspectRatio}]`;
      const updateData = { 
        status: 'video_requested_local',
        visual_prompt_context: combinedDialogue,
        video_url: null
      };
      if (ignoreImages) {
        updateData.image_url = null; // Clear cached images to force Direct Text-to-Video
      }
      await supabase.from('reel_scenes').update(updateData).eq('id', leader.id);
    }
  };

  const handleCompileFullMovie = async () => {
    if (!selectedItem?.data?.id) return;
    const mode = portionSize === 1 ? 'scene_based' : 'portion_based';
    await supabase.from('reels').update({ 
      status: 'compiling_video',
      compile_mode: mode,
      final_video_url: null
    }).eq('id', selectedItem.data.id);
    fetchLists();
  };

  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  const fetchBlobSafe = async (url) => {
    if (!url) return null;
    try {
      if (url.includes('/storage/v1/object/public/media/')) {
        const path = url.split('/storage/v1/object/public/media/')[1].split('?')[0];
        const { data } = await supabase.storage.from('media').download(path);
        if (data) return data;
      }
      const res = await fetch(url);
      if (res.ok) return await res.blob();
    } catch (e) {
      console.warn("Direct fetch CORS blocked, using canvas fallback for:", url);
    }
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas conversion failed'));
          }, 'image/png');
        };
        img.onerror = (err) => reject(err);
        img.src = url;
      });
    } catch (e2) {
      console.error("Failed to fetch asset blob:", url, e2);
      return null;
    }
  };

  const handleDownloadZipTTS = async (job) => {
    try {
      const zip = new JSZip();
      if (job.audio_url) {
        const blob = await fetchBlobSafe(job.audio_url);
        if (blob) zip.file(`audio_${job.id.substring(0,8)}.mp3`, blob);
      }
      if (job.image_url) {
        const blob = await fetchBlobSafe(job.image_url);
        if (blob) zip.file(`image_${job.id.substring(0,8)}.png`, blob);
      }
      if (job.video_url) {
        const blob = await fetchBlobSafe(job.video_url);
        if (blob) zip.file(`video_${job.id.substring(0,8)}.mp4`, blob);
      }
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `Pipeline_TTS_${job.id.substring(0,8)}.zip`);
    } catch (err) { alert("Download failed. " + (err.message || 'CORS restriction')); }
  };

  const handleDownloadZipSleep = async () => {
    if (isDownloadingZip) return;
    setIsDownloadingZip(true);
    try {
      const zip = new JSZip();
      
      for (let i = 0; i < sleepScenes.length; i++) {
        const leader = sleepScenes[i][0];
        const unitName = portionSize === 1 ? `scene_${i+1}` : `portion_${i+1}`;
        if (leader.image_url) {
          const blob = await fetchBlobSafe(leader.image_url);
          if (blob) zip.file(`${unitName}_image.png`, blob);
        }
        if (leader.video_url) {
          const blob = await fetchBlobSafe(leader.video_url);
          if (blob) zip.file(`${unitName}_video.mp4`, blob);
        }
      }
      
      if (selectedItem?.data?.master_audio_url) {
        const blob = await fetchBlobSafe(selectedItem.data.master_audio_url);
        if (blob) zip.file(`master_audio.mp3`, blob);
      } else if (selectedItem?.data?.final_video_url) {
        const blob = await fetchBlobSafe(selectedItem.data.final_video_url);
        if (blob) zip.file(`final_video.mp4`, blob);
      }

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `Pipeline_${selectedItem.type === 'sleep' ? 'SleepStory' : 'Reel'}_${selectedItem.data.id.substring(0,8)}.zip`);
    } catch (err) {
      console.error("ZIP Generation error:", err);
      alert(`Download failed: ${err.message || 'CORS restriction'}`);
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const activeTtsData = selectedItem?.type === 'tts' 
    ? (ttsJobs.find(j => j.id === selectedItem.data.id) || selectedItem.data)
    : null;

  const unitLabel = portionSize === 1 ? 'Scene' : 'Portion';
  const totalUnitsCount = sleepScenes.length;
  const imagesDoneCount = sleepScenes.filter(p => p[0]?.image_url).length;
  const videosDoneCount = sleepScenes.filter(p => p[0]?.video_url).length;
  const audiosDoneCount = sleepScenes.filter(p => p.some(s => s.audio_url)).length;
  const hasActiveJobs = sleepScenes.some(p => p[0]?.status?.includes('requested') || p[0]?.status?.includes('generating'));

  const totalPortionPages = Math.ceil(sleepScenes.length / 5);
  const visiblePortions = sleepScenes.slice(portionPage * 5, (portionPage + 1) * 5);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', gap: '32px', height: 'calc(100vh - 120px)' }}>
      {/* Left Column: Lists */}
      <div className="glass-panel" style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '24px', borderBottom: '1px solid var(--border-light)' }}>
          <h2 style={{ fontSize: '20px', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Video size={24} color="#8b5cf6" /> Generation Hub
          </h2>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Standard Reels & Shorts */}
          <div>
            <h3 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>🎬 Standard Reels & Shorts</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {standardReels.map(reel => (
                <button 
                  key={reel.id}
                  onClick={() => setSelectedItem({ type: 'reel', data: reel })}
                  style={{ 
                    textAlign: 'left', padding: '12px', borderRadius: '8px', 
                    background: selectedItem?.data?.id === reel.id ? 'rgba(16, 185, 129, 0.2)' : 'rgba(0,0,0,0.2)',
                    border: `1px solid ${selectedItem?.data?.id === reel.id ? '#10b981' : 'transparent'}`,
                    color: 'white', cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '4px' }}>{reel.title || 'Untitled Reel'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{reel.reel_type || 'Reel'}</span>
                    <span>{new Date(reel.created_at).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Sleep Stories */}
          <div>
            <h3 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>🌙 Sleep Stories</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sleepStories.map(reel => (
                <button 
                  key={reel.id}
                  onClick={() => setSelectedItem({ type: 'sleep', data: reel })}
                  style={{ 
                    textAlign: 'left', padding: '12px', borderRadius: '8px', 
                    background: selectedItem?.data?.id === reel.id ? 'rgba(139, 92, 246, 0.2)' : 'rgba(0,0,0,0.2)',
                    border: `1px solid ${selectedItem?.data?.id === reel.id ? '#8b5cf6' : 'transparent'}`,
                    color: 'white', cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '4px' }}>{reel.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(reel.created_at).toLocaleDateString()}</div>
                </button>
              ))}
            </div>
          </div>

          {/* TTS Jobs */}
          <div>
            <h3 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>🎙️ TTS Jobs</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {ttsJobs.map(job => (
                <button 
                  key={job.id}
                  onClick={() => setSelectedItem({ type: 'tts', data: job })}
                  style={{ 
                    textAlign: 'left', padding: '12px', borderRadius: '8px', 
                    background: selectedItem?.data?.id === job.id ? 'rgba(139, 92, 246, 0.2)' : 'rgba(0,0,0,0.2)',
                    border: `1px solid ${selectedItem?.data?.id === job.id ? '#8b5cf6' : 'transparent'}`,
                    color: 'white', cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {job.text_content}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(job.created_at).toLocaleDateString()}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Pipeline Tracker */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '12px' }}>
        {!selectedItem ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', borderRadius: '16px', border: '1px dashed var(--border-light)' }}>
            Select a Reel, Sleep Story, or TTS Job from the left sidebar to start generating visuals.
          </div>
        ) : selectedItem.type === 'tts' && activeTtsData ? (
          <div className="glass-panel" style={{ padding: '32px' }}>
            <h2 style={{ fontSize: '24px', margin: '0 0 8px 0' }}>TTS Visual Pipeline</h2>
            <p style={{ color: 'var(--text-secondary)' }}>End-to-End Pipeline: Script -&gt; Audio -&gt; Image -&gt; Video -&gt; Download ZIP</p>
            
            <p style={{ fontSize: '15px', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', borderLeft: '3px solid #8b5cf6', marginBottom: '24px' }}>
              "{activeTtsData.text_content}"
            </p>

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px' }}>
              <audio src={activeTtsData.audio_url} controls style={{ flex: 1, filter: 'invert(1)', opacity: 0.8 }} />
            </div>

            {/* Step 1: Image */}
            <div style={{ marginBottom: '24px', borderTop: '1px solid var(--border-light)', paddingTop: '24px' }}>
              <h4 style={{ fontSize: '14px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ImageIcon size={16} /> Step 1: Keyframe Image
              </h4>
              {!activeTtsData.image_url && activeTtsData.status !== 'image_requested_local' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {activeTtsData.status === 'error' && (
                     <div style={{ color: '#ef4444', fontSize: '13px', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '6px' }}>⚠️ Generation Failed. Check Terminal.</div>
                  )}
                  <button onClick={() => handleTTSImageRequest(activeTtsData.id)} className="btn-primary" style={{ background: '#f59e0b', borderColor: '#f59e0b' }}>
                    Generate FLUX Image
                  </button>
                </div>
              ) : activeTtsData.status === 'image_requested_local' ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#f59e0b', padding: '12px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Loader2 className="spin" size={16} /> Rendering Image...
                  </div>
                  <button onClick={() => supabase.from('tts_jobs').update({ status: 'pending' }).eq('id', activeTtsData.id)} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', color: '#ef4444' }}>
                    🛑 Cancel
                  </button>
                </div>
              ) : activeTtsData.image_url && (
                <div>
                  <img src={activeTtsData.image_url} alt="Keyframe" style={{ width: '100%', maxWidth: '500px', borderRadius: '12px', marginBottom: '12px' }} />
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={() => handleTTSImageRequest(activeTtsData.id)} className="btn-secondary">Regenerate Image</button>
                    
                    {!activeTtsData.video_url && activeTtsData.status !== 'video_requested_local' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                        {activeTtsData.status === 'error' && (
                           <div style={{ color: '#ef4444', fontSize: '13px', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '6px' }}>⚠️ Generation Failed. Check Terminal.</div>
                        )}
                        <button onClick={() => handleTTSVideoRequest(activeTtsData.id)} className="btn-primary" style={{ background: '#10b981', borderColor: '#10b981', width: '100%' }}>
                          Approve & Animate
                        </button>
                      </div>
                    ) : activeTtsData.status === 'video_requested_local' ? (
                       <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', flex: 1 }}>
                        <Loader2 className="spin" size={16} /> Animating...
                      </div>
                    ) : activeTtsData.video_url && (
                      <button onClick={() => handleTTSVideoRequest(activeTtsData.id)} className="btn-primary" style={{ background: '#10b981', borderColor: '#10b981' }}>
                        Regenerate Video
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: Video */}
            {(activeTtsData.status === 'video_requested_local' || activeTtsData.video_url) && (
              <div style={{ marginBottom: '24px', borderTop: '1px solid var(--border-light)', paddingTop: '24px' }}>
                <h4 style={{ fontSize: '14px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Video size={16} /> Step 2: Video Animation
                </h4>
                {activeTtsData.status === 'video_requested_local' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px' }}>
                    <Loader2 className="spin" size={16} /> Animating via LTX-Video... (~1 min)
                  </div>
                ) : activeTtsData.video_url && (
                  <video src={activeTtsData.video_url} controls loop autoPlay muted style={{ width: '100%', maxWidth: '500px', borderRadius: '12px' }} />
                )}
              </div>
            )}

            {activeTtsData.video_url && (
              <button onClick={() => handleDownloadZipTTS(activeTtsData)} className="btn-primary" style={{ width: '100%', padding: '16px', fontSize: '16px', background: '#8b5cf6', borderColor: '#8b5cf6' }}>
                <Archive size={20} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'middle' }}/> Download Assets (.zip)
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* Header Title & Batch Controls */}
            <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h2 style={{ fontSize: '24px', margin: '0 0 4px 0' }}>{selectedItem.data.title || 'Untitled Project'}</h2>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Divided into {sleepScenes.length} Visual {unitLabel}s ({portionSize === 4 ? 'Portion-Based' : 'Scene-Based'})</p>
              </div>
              
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <option value="16:9">Horizontal (16:9)</option>
                  <option value="9:16">Vertical (9:16)</option>
                </select>

                <select 
                  value={portionSize} 
                  onChange={(e) => {
                    const size = Number(e.target.value);
                    setPortionSize(size);
                    if (selectedItem?.data?.id) fetchSleepScenes(selectedItem.data.id, size);
                  }} 
                  style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <option value={4}>📦 Portion-Based (4 Scenes / Unit)</option>
                  <option value={1}>🎬 Scene-Based (1 Scene / Unit)</option>
                </select>

                <button onClick={handleGenerateAllPortionImages} className="btn-primary" style={{ background: '#f59e0b', borderColor: '#f59e0b' }}>
                  <ImageIcon size={16} style={{ display: 'inline', marginRight: '6px' }}/> Generate All Images
                </button>
                <button onClick={() => handleGenerateAllPortionVideos(false)} className="btn-primary" style={{ background: '#10b981', borderColor: '#10b981' }}>
                  <Video size={16} style={{ display: 'inline', marginRight: '6px' }}/> Animate All ({unitLabel}s)
                </button>
                <button onClick={() => handleGenerateAllPortionVideos(true)} className="btn-primary" style={{ background: '#059669', borderColor: '#059669' }}>
                  <Sparkles size={16} style={{ display: 'inline', marginRight: '6px' }}/> Direct Text-to-Video (Ignore Images)
                </button>
                <button onClick={handleCompileFullMovie} className="btn-primary" style={{ background: '#6366f1', borderColor: '#6366f1' }}>
                  <Video size={16} style={{ display: 'inline', marginRight: '6px' }}/> Compile Full Movie
                </button>

                {/* Cancel All Active Jobs Button */}
                {hasActiveJobs && (
                  <button onClick={handleCancelAllActiveJobs} className="btn-primary" style={{ background: '#ef4444', borderColor: '#ef4444' }}>
                    <XCircle size={16} style={{ display: 'inline', marginRight: '6px' }}/> 🛑 Stop All Active Jobs
                  </button>
                )}

                {/* Reset Assets Delete Menu */}
                <select 
                  onChange={(e) => {
                    if (e.target.value) {
                      handleResetAllStoryAssets(e.target.value);
                      e.target.value = '';
                    }
                  }} 
                  style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid #ef4444', cursor: 'pointer' }}
                >
                  <option value="">🗑️ Delete / Reset Assets...</option>
                  <option value="images">Delete All Generated Images</option>
                  <option value="videos">Delete All Generated Videos</option>
                  <option value="all">Delete Entire Visual Pipeline (Images + Videos)</option>
                </select>

                <button onClick={handleDownloadZipSleep} disabled={isDownloadingZip} className="btn-primary" style={{ background: '#8b5cf6', borderColor: '#8b5cf6' }}>
                  {isDownloadingZip ? <Loader2 className="spin" size={16} style={{ display: 'inline', marginRight: '6px' }} /> : <Archive size={16} style={{ display: 'inline', marginRight: '6px' }} />}
                  {isDownloadingZip ? 'Creating ZIP...' : 'Download ZIP'}
                </button>
              </div>
            </div>

            {/* Real-time Work Progress Counter & View Filter Banner */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', background: 'rgba(0,0,0,0.25)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-light)', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{unitLabel} Audios</span>
                  <strong style={{ fontSize: '18px', color: '#8b5cf6' }}>{audiosDoneCount} / {totalUnitsCount}</strong>
                </div>
                <div style={{ height: '28px', width: '1px', background: 'var(--border-light)' }} />
                <div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{unitLabel} Images</span>
                  <strong style={{ fontSize: '18px', color: '#f59e0b' }}>{imagesDoneCount} / {totalUnitsCount}</strong>
                </div>
                <div style={{ height: '28px', width: '1px', background: 'var(--border-light)' }} />
                <div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{unitLabel} Videos</span>
                  <strong style={{ fontSize: '18px', color: '#10b981' }}>{videosDoneCount} / {totalUnitsCount}</strong>
                </div>
              </div>

              {/* View Mode Mode Filter Tabs */}
              <div style={{ display: 'flex', gap: '6px', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <button 
                  onClick={() => setViewFilter('all')}
                  className={viewFilter === 'all' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px' }}
                >
                  All Steps View
                </button>
                <button 
                  onClick={() => setViewFilter('images')}
                  className={viewFilter === 'images' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px', background: viewFilter === 'images' ? '#f59e0b' : 'transparent', borderColor: viewFilter === 'images' ? '#f59e0b' : 'transparent' }}
                >
                  🖼️ Generated Images Only
                </button>
                <button 
                  onClick={() => setViewFilter('videos')}
                  className={viewFilter === 'videos' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px', background: viewFilter === 'videos' ? '#10b981' : 'transparent', borderColor: viewFilter === 'videos' ? '#10b981' : 'transparent' }}
                >
                  🎬 Generated Videos Only
                </button>
              </div>
            </div>

            {/* Movie Stitching Status / Player */}
            {(selectedItem.data.status === 'compiling_video' || selectedItem.data.status === 'processing_compilation') && (
              <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px', textAlign: 'center', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid #6366f1' }}>
                <Loader2 className="spin" size={32} style={{ margin: '0 auto 12px auto', color: '#6366f1' }} />
                <h3 style={{ margin: '0 0 8px 0', color: '#6366f1' }}>Stitching Full Movie via FFmpeg...</h3>
                <p style={{ margin: '0 0 16px 0', color: 'var(--text-muted)' }}>Retiming visual units ({unitLabel}s) & looping visuals to cover 100% of master audio duration. (~1 min)</p>
                <button onClick={() => supabase.from('reels').update({ status: 'pending' }).eq('id', selectedId).then(() => fetchLists())} className="btn-secondary" style={{ color: '#ef4444', borderColor: '#ef4444' }}>
                  🛑 Cancel Movie Compilation
                </button>
              </div>
            )}

            {selectedItem.data.final_video_url && (
              <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px', border: '1px solid #10b981' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Video size={20} /> Full Stitched Movie Ready!
                  </h3>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => supabase.from('reels').update({ final_video_url: null }).eq('id', selectedId).then(() => fetchLists())} className="btn-secondary" style={{ color: '#ef4444', borderColor: '#ef4444' }}>
                      <Trash2 size={15} style={{ display: 'inline', marginRight: '4px' }} /> Delete Movie
                    </button>
                    <a href={selectedItem.data.final_video_url} download target="_blank" rel="noreferrer" className="btn-primary" style={{ background: '#10b981', borderColor: '#10b981', textDecoration: 'none' }}>
                      <Download size={16} style={{ display: 'inline', marginRight: '6px' }} /> Download Stitched Movie (.mp4)
                    </a>
                  </div>
                </div>
                <video controls src={selectedItem.data.final_video_url} style={{ width: '100%', maxHeight: '450px', borderRadius: '12px', background: '#000' }} />
              </div>
            )}
            
            <div>
              {totalPortionPages > 1 && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
                  {Array.from({ length: totalPortionPages }).map((_, pIdx) => (
                    <button
                      key={pIdx}
                      onClick={() => setPortionPage(pIdx)}
                      className={portionPage === pIdx ? "btn-primary" : "btn-secondary"}
                      style={{ padding: '6px 14px', fontSize: '13px', borderRadius: '8px' }}
                    >
                      {unitLabel}s {pIdx * 5 + 1}–{Math.min((pIdx + 1) * 5, sleepScenes.length)}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {visiblePortions.map((portion, vIdx) => {
                  const portionIndex = portionPage * 5 + vIdx;
                  const leader = portion[0];
                  const scenesCount = portion.length;

                  // -------------------------------------------------------------
                  // MODE 1: GENERATED IMAGES ONLY (Side-by-Side Image + Script/Audio)
                  // -------------------------------------------------------------
                  if (viewFilter === 'images') {
                    return (
                      <div key={portionIndex} className="glass-panel" style={{ padding: '24px', display: 'flex', gap: '24px', alignItems: 'center' }}>
                        {/* Left Side: FLUX Image */}
                        <div style={{ flex: '0 0 45%', width: '45%' }}>
                          {leader.image_url ? (
                            <div>
                              <img src={leader.image_url} alt={`${unitLabel} ${portionIndex + 1}`} style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--border-light)' }} />
                              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                <button onClick={() => handlePortionImageRequest(portion)} className="btn-secondary" style={{ flex: 1 }}>
                                  Regenerate
                                </button>
                                <button onClick={() => handleDeletePortionImage(portion)} className="btn-secondary" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
                                  <Trash2 size={16} /> Delete
                                </button>
                              </div>
                            </div>
                          ) : (leader.status === 'image_requested_local' || leader.status === 'processing_image') ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: '#f59e0b', padding: '40px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '12px', border: '1px dashed #f59e0b' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Loader2 className="spin" size={20} /> Rendering FLUX Image...
                              </div>
                              <button onClick={() => handleCancelPortionGeneration(portion)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>
                                🛑 Stop / Cancel
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => handlePortionImageRequest(portion)} className="btn-primary" style={{ background: '#f59e0b', borderColor: '#f59e0b', width: '100%', padding: '30px', fontSize: '15px' }}>
                              Generate FLUX Image for {unitLabel} {portionIndex + 1}
                            </button>
                          )}
                        </div>

                        {/* Right Side: Portion Script & Audio Player */}
                        <div style={{ flex: 1 }}>
                          <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{unitLabel} {portionIndex + 1}</span>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px' }}>
                              Covers {scenesCount} {scenesCount === 1 ? 'scene' : 'scenes'}
                            </span>
                          </h3>

                          <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            {portion.map((s, sIdx) => (
                              <div key={sIdx} style={{ marginBottom: '10px' }}>
                                <p style={{ margin: '0 0 4px 0' }}>{s.dialogue}</p>
                                {s.audio_url && <audio src={s.audio_url} controls style={{ height: '26px', width: '100%', opacity: 0.8 }} />}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // -------------------------------------------------------------
                  // MODE 2: GENERATED VIDEOS ONLY (Side-by-Side Video + Script/Audio)
                  // -------------------------------------------------------------
                  if (viewFilter === 'videos') {
                    return (
                      <div key={portionIndex} className="glass-panel" style={{ padding: '24px', display: 'flex', gap: '24px', alignItems: 'center' }}>
                        {/* Left Side: Wan2.x Video */}
                        <div style={{ flex: '0 0 45%', width: '45%' }}>
                          {leader.video_url ? (
                            <div>
                              <video src={leader.video_url} controls loop autoPlay muted style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--border-light)' }} />
                              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                <button onClick={() => handlePortionVideoRequest(portion, false)} className="btn-secondary" style={{ flex: 1 }}>
                                  Regenerate
                                </button>
                                <button onClick={() => handleDeletePortionVideo(portion)} className="btn-secondary" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
                                  <Trash2 size={16} /> Delete
                                </button>
                              </div>
                            </div>
                          ) : (leader.status === 'video_requested_local' || leader.status === 'processing_video') ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: '#10b981', padding: '40px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', border: '1px dashed #10b981' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Loader2 className="spin" size={20} /> Animating via Wan2.x...
                              </div>
                              <button onClick={() => handleCancelPortionGeneration(portion)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>
                                🛑 Stop / Cancel
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <button onClick={() => handlePortionVideoRequest(portion, false)} className="btn-primary" style={{ background: '#10b981', borderColor: '#10b981', width: '100%', padding: '14px', fontSize: '14px' }}>
                                Animate {unitLabel} {portionIndex + 1} {leader.image_url ? '(From Image)' : ''}
                              </button>
                              {leader.image_url && (
                                <button onClick={() => handlePortionVideoRequest(portion, true)} className="btn-secondary" style={{ width: '100%', padding: '10px', fontSize: '12px', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}>
                                  ⚡ Direct Text-to-Video (Ignore Image)
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Right Side: Portion Script & Audio Player */}
                        <div style={{ flex: 1 }}>
                          <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{unitLabel} {portionIndex + 1}</span>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px' }}>
                              Covers {scenesCount} {scenesCount === 1 ? 'scene' : 'scenes'}
                            </span>
                          </h3>

                          <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            {portion.map((s, sIdx) => (
                              <div key={sIdx} style={{ marginBottom: '10px' }}>
                                <p style={{ margin: '0 0 4px 0' }}>{s.dialogue}</p>
                                {s.audio_url && <audio src={s.audio_url} controls style={{ height: '26px', width: '100%', opacity: 0.8 }} />}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // -------------------------------------------------------------
                  // MODE 3: ALL STEPS VIEW (Full Pipeline Stacked View)
                  // -------------------------------------------------------------
                  return (
                    <div key={portionIndex} className="glass-panel" style={{ padding: '24px' }}>
                      <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{unitLabel} {portionIndex + 1}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'normal', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px' }}>
                          Covers {scenesCount} {scenesCount === 1 ? 'audio scene' : 'audio scenes'}
                        </span>
                      </h3>
                      
                      {/* Audio Script for this Portion */}
                      <div style={{ maxHeight: '140px', overflowY: 'auto', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                        {portion.map((s, sIdx) => (
                          <div key={sIdx} style={{ marginBottom: '8px' }}>
                            <p style={{ margin: '0 0 4px 0' }}>{s.dialogue}</p>
                            {s.audio_url && <audio src={s.audio_url} controls style={{ height: '26px', width: '100%', opacity: 0.7 }} />}
                          </div>
                        ))}
                      </div>

                      {/* Step 1: ONE Image for this Portion */}
                      <div style={{ marginBottom: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <ImageIcon size={15} /> Keyframe Image
                          </h4>
                          {leader.image_url && (
                            <button onClick={() => handleDeletePortionImage(portion)} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
                              <Trash2 size={13} style={{ display: 'inline', marginRight: '4px' }} /> Delete Image
                            </button>
                          )}
                        </div>

                        {!leader.image_url && leader.status !== 'image_requested_local' && leader.status !== 'processing_image' ? (
                          <button onClick={() => handlePortionImageRequest(portion)} className="btn-primary" style={{ background: '#f59e0b', borderColor: '#f59e0b', width: '100%' }}>
                            Generate Image for {unitLabel} {portionIndex + 1}
                          </button>
                        ) : (leader.status === 'image_requested_local' || leader.status === 'processing_image') ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#f59e0b', padding: '12px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Loader2 className="spin" size={16} /> Rendering FLUX Image...
                            </div>
                            <button onClick={() => handleCancelPortionGeneration(portion)} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
                              🛑 Stop / Cancel
                            </button>
                          </div>
                        ) : (
                          <div>
                            <img src={leader.image_url} alt={`${unitLabel} ${portionIndex + 1}`} style={{ width: '100%', borderRadius: '12px', marginBottom: '12px' }} />
                            <button onClick={() => handlePortionImageRequest(portion)} className="btn-secondary" style={{ width: '100%', marginBottom: '16px' }}>
                              Regenerate Image
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Step 2: ONE Video for this Portion */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Video size={15} /> Video Animation
                          </h4>
                          {leader.video_url && (
                            <button onClick={() => handleDeletePortionVideo(portion)} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
                              <Trash2 size={13} style={{ display: 'inline', marginRight: '4px' }} /> Delete Video
                            </button>
                          )}
                        </div>

                        {!leader.video_url && leader.status !== 'video_requested_local' && leader.status !== 'processing_video' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button onClick={() => handlePortionVideoRequest(portion, false)} className="btn-primary" style={{ background: '#10b981', borderColor: '#10b981', width: '100%' }}>
                              Animate {unitLabel} {portionIndex + 1} {leader.image_url ? '(From Image)' : ''}
                            </button>
                            {leader.image_url && (
                              <button onClick={() => handlePortionVideoRequest(portion, true)} className="btn-secondary" style={{ width: '100%', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}>
                                ⚡ Direct Text-to-Video (Ignore Image)
                              </button>
                            )}
                          </div>
                        ) : (leader.status === 'video_requested_local' || leader.status === 'processing_video') ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#10b981', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Loader2 className="spin" size={16} /> Animating via Wan2.x...
                            </div>
                            <button onClick={() => handleCancelPortionGeneration(portion)} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
                              🛑 Stop / Cancel
                            </button>
                          </div>
                        ) : (
                          <div>
                            <video src={leader.video_url} controls loop autoPlay muted style={{ width: '100%', borderRadius: '12px', marginBottom: '12px' }} />
                            <button onClick={() => handlePortionVideoRequest(portion, false)} className="btn-secondary" style={{ width: '100%' }}>
                              Regenerate Video
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
