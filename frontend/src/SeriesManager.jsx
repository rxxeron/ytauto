import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Folder, Plus, ChevronRight, PlaySquare, Settings, Trash2, ArrowLeft, Globe } from 'lucide-react';
import WorldBuilder from './WorldBuilder';

export default function SeriesManager() {
  const [seriesList, setSeriesList] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'world_builder'

  useEffect(() => {
    fetchSeries();
  }, []);

  const fetchSeries = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('series').select('*').order('created_at', { ascending: false });
    if (!error) setSeriesList(data || []);
    setLoading(false);
  };

  const fetchSeriesDetails = async (seriesId) => {
    const { data: sData } = await supabase.from('seasons').select('*').eq('series_id', seriesId).order('season_number', { ascending: true });
    const { data: eData } = await supabase.from('episodes').select('*').eq('series_id', seriesId).order('episode_number', { ascending: true });
    
    setSeasons(sData || []);
    setEpisodes(eData || []);
  };

  const handleCreateSeries = async () => {
    const title = prompt("Enter a name for your new Series (e.g., 'The Adventures of Spiderman'):");
    if (!title) return;
    
    const { data, error } = await supabase.from('series').insert({ title }).select().single();
    if (error) {
      alert("Error: " + error.message);
    } else {
      setSeriesList([data, ...seriesList]);
    }
  };

  const handleSelectSeries = (series) => {
    setSelectedSeries(series);
    fetchSeriesDetails(series.id);
  };

  const handleCreateSeason = async () => {
    const seasonNumber = seasons.length + 1;
    const title = prompt(`Enter a title for Season ${seasonNumber} (or leave blank):`);
    
    const { data, error } = await supabase.from('seasons').insert({
      series_id: selectedSeries.id,
      season_number: seasonNumber,
      title: title || `Season ${seasonNumber}`
    }).select().single();
    
    if (error) {
      alert("Error: " + error.message);
    } else {
      setSeasons([...seasons, data]);
    }
  };

  const handleCreateEpisode = async (season) => {
    const title = prompt(`Enter a title for the new episode in ${season.title || 'Season ' + season.season_number}:`);
    if (!title) return;
    
    // Calculate episode number
    const nextEpNum = episodes.filter(e => e.season_id === season.id).length + 1;

    const { data, error } = await supabase.from('episodes').insert({
      series_id: selectedSeries.id,
      season_id: season.id,
      episode_number: nextEpNum,
      title: title,
      status: 'draft' // Triggers bake-off
    }).select().single();
    
    if (error) {
      alert("Error: " + error.message);
    } else {
      setEpisodes([...episodes, data]);
      alert("Episode created! The Python AI Orchestrator will now begin the Bake-off.");
    }
  };

  const handleDeleteEpisode = async (episodeId) => {
    if (!window.confirm("Are you sure you want to permanently delete this episode? This will delete all its chats and assets too!")) return;
    const { error } = await supabase.from('episodes').delete().eq('id', episodeId);
    if (error) {
      alert("Error deleting: " + error.message);
    } else {
      setEpisodes(episodes.filter(ep => ep.id !== episodeId));
    }
  };

  const handleDeleteSeason = async (seasonId) => {
    if (!window.confirm("Are you sure you want to delete this season and ALL of its episodes?")) return;
    const { error } = await supabase.from('seasons').delete().eq('id', seasonId);
    if (error) {
      alert("Error deleting: " + error.message);
    } else {
      setSeasons(seasons.filter(s => s.id !== seasonId));
      setEpisodes(episodes.filter(ep => ep.season_id !== seasonId));
    }
  };

  const handleDeleteSeries = async (seriesId) => {
    if (!window.confirm("Are you REALLY sure? This will delete the entire Series, all Seasons, Episodes, and Assets!")) return;
    const { error } = await supabase.from('series').delete().eq('id', seriesId);
    if (error) {
      alert("Error deleting: " + error.message);
    } else {
      setSeriesList(seriesList.filter(s => s.id !== seriesId));
      setSelectedSeries(null);
      setViewMode('list');
    }
  };

  const handleUpdateEpisodeStatus = async (episodeId, newStatus) => {
    const { error } = await supabase.from('episodes').update({ status: newStatus }).eq('id', episodeId);
    if (error) {
      alert("Error updating status: " + error.message);
    } else {
      setEpisodes(episodes.map(ep => ep.id === episodeId ? { ...ep, status: newStatus } : ep));
    }
  };

  const handleUpdatePublishLink = async (episodeId, link) => {
    const { error } = await supabase.from('episodes').update({ publish_link: link }).eq('id', episodeId);
    if (error) {
      alert("Error saving link: " + error.message);
    } else {
      setEpisodes(episodes.map(ep => ep.id === episodeId ? { ...ep, publish_link: link } : ep));
    }
  };

  if (selectedSeries) {
    return (
      <div className="animate-fade-in">
        <button 
          onClick={() => { setSelectedSeries(null); setViewMode('list'); }} 
          className="btn-secondary" 
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '24px', padding: '6px 16px', fontSize: '13px' }}
        >
          <ArrowLeft size={16} /> Back to All Series
        </button>

        {viewMode === 'world_builder' ? (
          <WorldBuilder series={selectedSeries} onBack={() => setViewMode('list')} />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <div>
                <h1 style={{ fontSize: '32px', margin: '0 0 8px 0' }}>{selectedSeries.title}</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Manage seasons and episodes for this universe.</p>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn-secondary" onClick={() => setViewMode('world_builder')} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#8b5cf6', borderColor: 'rgba(139, 92, 246, 0.5)' }}>
                  <Globe size={18} /> World Builder (Pre-prod)
                </button>
                <button className="btn-primary" onClick={handleCreateSeason}>
                  + New Season
                </button>
                <button 
                  className="btn-secondary" 
                  onClick={() => handleDeleteSeries(selectedSeries.id)} 
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', borderColor: 'rgba(239, 68, 68, 0.5)', color: '#ef4444', marginLeft: '12px' }}
                >
                  <Trash2 size={16} /> Delete Series
                </button>
              </div>
            </div>

        {seasons.length === 0 ? (
          <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No seasons yet. Click "+ New Season" to get started.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {seasons.map(season => {
              const seasonEpisodes = episodes.filter(e => e.season_id === season.id);
              return (
                <div key={season.id} className="glass-panel" style={{ padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ fontSize: '20px', margin: 0 }}>
                      Season {season.season_number} {season.title && `- ${season.title}`}
                    </h2>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button className="btn-secondary" onClick={() => handleCreateEpisode(season)} style={{ padding: '6px 16px', fontSize: '13px' }}>
                        + Add Episode
                      </button>
                      <button className="btn-secondary" onClick={() => handleDeleteSeason(season.id)} style={{ padding: '6px 12px', fontSize: '13px', borderColor: 'rgba(239, 68, 68, 0.5)', color: '#ef4444' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  
                  {seasonEpisodes.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>No episodes in this season yet.</p>
                  ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
                            <th style={{ paddingBottom: '12px', fontWeight: '500', width: '80px' }}>Ep #</th>
                            <th style={{ paddingBottom: '12px', fontWeight: '500' }}>Title & Context</th>
                            <th style={{ paddingBottom: '12px', fontWeight: '500' }}>Status</th>
                            <th style={{ paddingBottom: '12px', fontWeight: '500', textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {seasonEpisodes.map(ep => (
                            <tr key={ep.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '16px 0', color: 'var(--text-secondary)', verticalAlign: 'top' }}>{ep.episode_number}</td>
                              <td style={{ padding: '16px 0', verticalAlign: 'top', paddingRight: '20px' }}>
                                <div style={{ fontWeight: '500', marginBottom: '4px' }}>{ep.title}</div>
                                {ep.overall_summary && (
                                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                    {ep.overall_summary}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: '16px 0', verticalAlign: 'top' }}>
                                  <span style={{ 
                                    background: ep.status === 'ready' ? 'rgba(59, 130, 246, 0.2)' : ep.status === 'posted' ? 'rgba(139, 92, 246, 0.2)' : ep.status === 'approved' || ep.status === 'audio_ready' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(255, 255, 255, 0.1)', 
                                    color: ep.status === 'ready' ? '#60a5fa' : ep.status === 'posted' ? '#a78bfa' : ep.status === 'approved' || ep.status === 'audio_ready' ? '#34d399' : 'white', 
                                    padding: '4px 10px', 
                                    borderRadius: '99px', 
                                    fontSize: '12px', 
                                    textTransform: 'capitalize',
                                    whiteSpace: 'nowrap'
                                  }}>
                                    {ep.status.replace('_', ' ')}
                                  </span>
                                  
                                  {/* Status quick actions */}
                                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                    {ep.status !== 'ready' && ep.status !== 'posted' && (
                                      <button onClick={() => handleUpdateEpisodeStatus(ep.id, 'ready')} style={{ fontSize: '11px', background: 'transparent', border: '1px solid rgba(59, 130, 246, 0.5)', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}>Mark Ready</button>
                                    )}
                                    {ep.status === 'ready' && (
                                      <button onClick={() => handleUpdateEpisodeStatus(ep.id, 'posted')} style={{ fontSize: '11px', background: 'transparent', border: '1px solid rgba(139, 92, 246, 0.5)', color: '#a78bfa', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}>Mark Posted</button>
                                    )}
                                  </div>

                                  {/* Publish Link Input */}
                                  {(ep.status === 'ready' || ep.status === 'posted') && (
                                    <div style={{ marginTop: '12px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                      <input 
                                        type="text" 
                                        placeholder="Google Drive / Partner Link..." 
                                        value={ep.publish_link || ''}
                                        onChange={(e) => {
                                          setEpisodes(episodes.map(eObj => eObj.id === ep.id ? { ...eObj, publish_link: e.target.value } : eObj));
                                        }}
                                        onBlur={(e) => handleUpdatePublishLink(ep.id, e.target.value)}
                                        style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white', width: '180px' }}
                                      />
                                      {ep.publish_link && (
                                        <a href={ep.publish_link} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: '#60a5fa', textDecoration: 'none', marginLeft: '4px' }}>
                                          Open
                                        </a>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: '16px 0', textAlign: 'right', verticalAlign: 'top', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                                  <button 
                                    className="btn-secondary" 
                                    onClick={() => window.dispatchEvent(new CustomEvent('openEpisode', { detail: ep }))} 
                                    style={{ padding: '6px 12px', fontSize: '12px', width: '140px', justifyContent: 'center' }}
                                  >
                                    Director Chat
                                  </button>
                                  
                                  <button 
                                    className="btn-primary" 
                                    onClick={() => {
                                      const e = new CustomEvent('openEpisode', { detail: { ...ep, forceAssets: true } });
                                      window.dispatchEvent(e);
                                    }} 
                                    style={{ padding: '6px 12px', fontSize: '12px', width: '140px', justifyContent: 'center' }}
                                  >
                                    View Assets & Audio
                                  </button>
                                  
                                  <button 
                                    className="btn-secondary" 
                                    onClick={() => handleDeleteEpisode(ep.id)} 
                                    style={{ padding: '6px 12px', fontSize: '12px', width: '140px', justifyContent: 'center', borderColor: 'rgba(239, 68, 68, 0.5)', color: '#ef4444' }}
                                  >
                                    <Trash2 size={12} style={{ marginRight: '4px' }}/> Delete Episode
                                  </button>
                                </td>
                            </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '32px', margin: '0 0 8px 0' }}>Series Manager</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Your AI Story Universes</p>
        </div>
        <button className="btn-primary" onClick={handleCreateSeries}>
          + Create New Series
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading series...</p>
      ) : seriesList.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          No series found. Create one to start your universe!
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
          {seriesList.map(series => (
            <div 
              key={series.id} 
              className="glass-panel card-hover" 
              style={{ padding: '24px', cursor: 'pointer', transition: 'all 0.2s' }}
              onClick={() => handleSelectSeries(series)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
                  <Folder size={24} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px' }}>{series.title}</h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{series.genre || 'Story Universe'}</p>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', color: 'var(--accent-primary)', fontSize: '13px', fontWeight: '500' }}>
                Manage Episodes <ChevronRight size={16} style={{ marginLeft: '4px' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
