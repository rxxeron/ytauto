import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, Settings, PlaySquare, Bell, Search, LogOut, Loader, Folder, Key, Mic, Database } from 'lucide-react';
import { supabase } from './supabaseClient';
import Auth from './Auth';
import BakeOffView from './BakeOffView';
import ParallelChatView from './ParallelChatView';
import ParallelReelChatView from './ParallelReelChatView';
import ScriptReader from './ScriptReader';
import SceneManager from './SceneManager';
import SeriesManager from './SeriesManager';
import ReelsManager from './ReelsManager';
import ReelAssetsView from './ReelAssetsView';
import APIKeysDashboard from './APIKeysDashboard';
import PartnersManager from './PartnersManager';
import TTSUtility from './TTSUtility';
import StorageManager from './StorageManager';
import './index.css';

function useQueryState(key, defaultValue) {
  const [state, setState] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) || defaultValue;
  });

  useEffect(() => {
    const url = new URL(window.location);
    if (state) {
      url.searchParams.set(key, state);
    } else {
      url.searchParams.delete(key);
    }
    window.history.replaceState({}, '', url);
  }, [key, state]);

  return [state, setState];
}

function App() {
  const [session, setSession] = useState(null);
  const [activeTab, setActiveTab] = useQueryState('tab', 'dashboard');
  const [profile, setProfile] = useState(null);
  
  // Dashboard Stats
  const [episodes, setEpisodes] = useState([]);
  const [activeReels, setActiveReels] = useState([]);
  const [stats, setStats] = useState({ series: 0, pendingBakeOffs: 0, scenes: 0 });
  const [loading, setLoading] = useState(true);

  // App Navigation State
  const [selectedEpisodeId, setSelectedEpisodeId] = useQueryState('ep', null);
  const [selectedReelId, setSelectedReelId] = useQueryState('reel', null);
  const [viewMode, setViewMode] = useQueryState('view', 'chat'); // 'chat' or 'read'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
    });

    const handleOpenEpisode = (e) => {
      const ep = e.detail;
      setSelectedEpisodeId(ep.id);
      setSelectedReelId(null);
      
      let newMode = 'chat';
      if (ep.forceAssets) {
        newMode = 'scenes';
      } else {
        if (ep.status === 'approved') newMode = 'read';
        if (['prompts_ready', 'generating_prompts', 'error_prompts', 'generating_audio', 'audio_ready', 'compiling_video', 'completed', 'error'].includes(ep.status)) newMode = 'scenes';
      }
      
      setViewMode(newMode);
      setActiveTab('chat');
    };
    
    const handleOpenReelChat = (e) => {
      const reel = e.detail;
      setSelectedReelId(reel.id);
      setSelectedEpisodeId(null);
      setViewMode('chat');
      setActiveTab('reel_chat');
    };

    const handleOpenReelAssets = (e) => {
      const reel = e.detail;
      setSelectedReelId(reel.id);
      setSelectedEpisodeId(null);
      setViewMode('scenes');
      setActiveTab('reel_chat');
    };
    
    window.addEventListener('openEpisode', handleOpenEpisode);
    window.addEventListener('openReelChat', handleOpenReelChat);
    window.addEventListener('openReelAssets', handleOpenReelAssets);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('openEpisode', handleOpenEpisode);
      window.removeEventListener('openReelChat', handleOpenReelChat);
      window.removeEventListener('openReelAssets', handleOpenReelAssets);
    };
  }, []);

  useEffect(() => {
    if (session && activeTab === 'dashboard' && !selectedEpisodeId && !selectedReelId) {
      fetchDashboardData();
    }
  }, [session, activeTab, selectedEpisodeId, selectedReelId]);

  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (!error) setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error.message);
    }
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // 1. Fetch episodes
      const { data: epData, error: epError } = await supabase
        .from('episodes')
        .select('*, series(title), seasons(title)')
        .order('created_at', { ascending: false })
        .limit(10);
      if (epError) throw epError;
      setEpisodes(epData || []);

      // 1.5 Fetch Reels & Sleep Stories
      const { data: reelData, error: reelErr } = await supabase
        .from('reels')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      if (!reelErr) setActiveReels(reelData || []);

      // 2. Fetch stats (Series count)
      const { count: seriesCount } = await supabase.from('series').select('*', { count: 'exact', head: true });
      
      // 3. Fetch stats (Pending Bake-offs - drafts_ready status)
      const { count: pendingCount } = await supabase.from('episodes').select('*', { count: 'exact', head: true }).eq('status', 'drafts_ready');

      // 4. Fetch stats (Total scenes generated)
      const { count: scenesCount } = await supabase.from('scenes').select('*', { count: 'exact', head: true });

      setStats({
        series: seriesCount || 0,
        pendingBakeOffs: pendingCount || 0,
        scenes: scenesCount || 0
      });

    } catch (error) {
      console.error("Error fetching dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return <Auth onLogin={setSession} />;
  }

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PlaySquare size={24} color="white" />
          </div>
          <h2 style={{ margin: 0, fontSize: '22px' }}>YTAuto Studio</h2>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <NavItem icon={<LayoutDashboard size={20} />} label="Bake-Off Board" active={activeTab === 'dashboard' && !selectedEpisodeId && !selectedReelId} onClick={() => { setActiveTab('dashboard'); setSelectedEpisodeId(null); setSelectedReelId(null); }} />
          <NavItem icon={<Folder size={20} />} label="Series Manager" active={activeTab === 'series_manager'} onClick={() => { setActiveTab('series_manager'); setSelectedEpisodeId(null); setSelectedReelId(null); }} />
          <NavItem icon={<PlaySquare size={20} />} label="Shorts Studio" active={activeTab === 'reels_manager'} onClick={() => { setActiveTab('reels_manager'); setSelectedEpisodeId(null); setSelectedReelId(null); }} />
          <NavItem icon={<Mic size={20} />} label="TTS Studio" active={activeTab === 'tts_utility'} onClick={() => { setActiveTab('tts_utility'); setSelectedEpisodeId(null); setSelectedReelId(null); }} />
          <NavItem icon={<Database size={20} />} label="Cloud Storage" active={activeTab === 'storage_manager'} onClick={() => { setActiveTab('storage_manager'); setSelectedEpisodeId(null); setSelectedReelId(null); }} />

          {profile?.role === 'super_admin' && (
            <>
              <NavItem icon={<Key size={20} />} label="API Dashboard" active={activeTab === 'api_dashboard'} onClick={() => { setActiveTab('api_dashboard'); setSelectedEpisodeId(null); setSelectedReelId(null); }} />
              <NavItem icon={<Users size={20} />} label="Partners" active={activeTab === 'partners'} onClick={() => setActiveTab('partners')} />
              <NavItem icon={<Settings size={20} />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
            </>
          )}
        </nav>
        
        <div style={{ marginTop: 'auto', padding: '20px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-light)' }}>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>{profile?.full_name || session.user.email}</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px', textTransform: 'capitalize' }}>
            Role: {profile?.role?.replace('_', ' ') || 'Loading...'}
          </p>
          <button 
            className="btn-secondary" 
            style={{ width: '100%', fontSize: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
            onClick={() => supabase.auth.signOut()}
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <div>
            <h1 style={{ fontSize: '32px', margin: 0 }} className="animate-fade-in">Director Board</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Manage your AI Story universe and bake-off drafts.</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '99px' }}>
              <Search size={18} color="var(--text-muted)" style={{ marginRight: '8px' }} />
              <input type="text" placeholder="Search stories..." style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none' }} />
            </div>
            <button className="btn-secondary" style={{ padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bell size={20} />
            </button>
          </div>
        </header>

        {activeTab === 'series_manager' ? (
          <SeriesManager />
        ) : activeTab === 'reels_manager' ? (
          <ReelsManager />
        ) : activeTab === 'tts_utility' ? (
          <TTSUtility />
        ) : activeTab === 'storage_manager' ? (
          <StorageManager userRole={profile?.role} />
        ) : activeTab === 'api_dashboard' && profile?.role === 'super_admin' ? (
          <APIKeysDashboard />
        ) : activeTab === 'partners' && profile?.role === 'super_admin' ? (
          <PartnersManager />
        ) : selectedEpisodeId ? (
          viewMode === 'read' ? (
            <ScriptReader episodeId={selectedEpisodeId} onBack={() => setSelectedEpisodeId(null)} />
          ) : viewMode === 'scenes' ? (
            <SceneManager episodeId={selectedEpisodeId} onBack={() => setSelectedEpisodeId(null)} />
          ) : (
            <ParallelChatView episodeId={selectedEpisodeId} onBack={() => {
              setSelectedEpisodeId(null);
              setActiveTab('dashboard');
              setTimeout(() => setActiveTab('series_manager'), 10);
            }} />
          )
        ) : selectedReelId ? (
          viewMode === 'scenes' ? (
            <ReelAssetsView reelId={selectedReelId} onBack={() => setSelectedReelId(null)} />
          ) : (
            <ParallelReelChatView reelId={selectedReelId} onBack={() => {
              setSelectedReelId(null);
              setActiveTab('reels_manager');
            }} />
          )
        ) : (
          <>
            {/* Dashboard Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '32px' }}>
              <StatCard title="Total Series" value={stats.series} trend="Active universes" />
              <StatCard title="AI Bake-offs Pending" value={stats.pendingBakeOffs} trend={stats.pendingBakeOffs > 0 ? "Requires your choice" : "All caught up"} accent={stats.pendingBakeOffs > 0} />
              <StatCard title="Scenes Generated" value={stats.scenes} trend="Across all models" />
            </div>

            {/* Recent Activity Board */}
            <div className="glass-panel animate-fade-in" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '20px' }}>Recent Episodes (Story Queue)</h3>
                <button className="btn-primary" onClick={() => setActiveTab('series_manager')}>Go to Series Manager</button>
              </div>
              
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Loader className="spin" size={24} style={{ margin: '0 auto' }} />
                  <p style={{ marginTop: '12px' }}>Loading live data from Supabase...</p>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
                      <th style={{ paddingBottom: '16px', fontWeight: '500' }}>Episode Title</th>
                      <th style={{ paddingBottom: '16px', fontWeight: '500' }}>Series / Season</th>
                      <th style={{ paddingBottom: '16px', fontWeight: '500' }}>Status</th>
                      <th style={{ paddingBottom: '16px', fontWeight: '500' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {episodes.length === 0 ? (
                      <tr>
                        <td colSpan="4" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          No episodes yet. Go to the Series Manager to create one!
                        </td>
                      </tr>
                    ) : (
                      episodes.map(ep => (
                        <TableRow 
                          key={ep.id}
                          title={ep.title} 
                          series={`${ep.series?.title || 'Unknown Series'} ${ep.seasons ? '- ' + (ep.seasons.title || 'Season ' + ep.seasons.season_number) : ''}`} 
                          status={ep.status} 
                          onReview={() => window.dispatchEvent(new CustomEvent('openEpisode', { detail: ep }))}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
            
            <div className="glass-panel animate-fade-in" style={{ padding: '24px', marginTop: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '20px' }}>Ongoing Shorts & Sleep Stories</h3>
                <button className="btn-primary" onClick={() => setActiveTab('reels_manager')}>Go to Shorts Studio</button>
              </div>
              
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Loader className="spin" size={24} style={{ margin: '0 auto' }} />
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
                      <th style={{ paddingBottom: '16px', fontWeight: '500' }}>Title</th>
                      <th style={{ paddingBottom: '16px', fontWeight: '500' }}>Format</th>
                      <th style={{ paddingBottom: '16px', fontWeight: '500' }}>Status</th>
                      <th style={{ paddingBottom: '16px', fontWeight: '500' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeReels.length === 0 ? (
                      <tr>
                        <td colSpan="4" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          No ongoing shorts. Go to Shorts Studio to create one!
                        </td>
                      </tr>
                    ) : (
                      activeReels.map(reel => (
                        <TableRow
                          key={reel.id}
                          title={reel.title || 'Untitled Reel'}
                          series={reel.reel_type === 'sleep' ? '🌙 Sleep Story' : '🎬 Historical'}
                          status={reel.status}
                          onReview={() => setSelectedReelId(reel.id)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// Components
function NavItem({ icon, label, active, onClick }) {
  return (
    <div 
      onClick={onClick}
      style={{ 
        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', 
        borderRadius: '12px', cursor: 'pointer',
        background: active ? 'var(--accent-bg)' : 'transparent',
        color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
        border: active ? '1px solid var(--accent-border)' : '1px solid transparent',
        transition: 'all 0.2s'
      }}
    >
      {icon}
      <span style={{ fontWeight: active ? '500' : '400', fontSize: '15px' }}>{label}</span>
    </div>
  );
}

function StatCard({ title, value, trend, accent }) {
  return (
    <div className="glass-panel" style={{ padding: '24px', border: accent ? '1px solid rgba(99, 102, 241, 0.4)' : '' }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '12px' }}>{title}</p>
      <h2 style={{ fontSize: '36px', margin: '0 0 8px 0', fontFamily: 'Inter', fontWeight: '600' }}>{value}</h2>
      <p style={{ fontSize: '13px', color: accent ? '#f87171' : '#34d399' }}>{trend}</p>
    </div>
  );
}

function TableRow({ title, series, status, onReview }) {
  const getStatusColor = () => {
    switch(status) {
      case 'approved': return { bg: 'rgba(52, 211, 153, 0.1)', color: '#34d399' };
      case 'generating': return { bg: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa' };
      case 'drafts_ready': return { bg: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24' };
      case 'failed': return { bg: 'rgba(248, 113, 113, 0.1)', color: '#f87171' };
      case 'draft': return { bg: 'rgba(255, 255, 255, 0.1)', color: '#e5e7eb' };
      default: return { bg: 'rgba(255,255,255,0.1)', color: 'white' };
    }
  }

  const s = getStatusColor();
  
  // Clean up snake_case to Title Case for UI
  const displayStatus = status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td style={{ padding: '20px 0', fontWeight: '500' }}>{title}</td>
      <td style={{ padding: '20px 0', color: 'var(--text-secondary)' }}>{series}</td>
      <td style={{ padding: '20px 0' }}>
        <span style={{ background: s.bg, color: s.color, padding: '6px 12px', borderRadius: '99px', fontSize: '12px', fontWeight: '500' }}>
          {displayStatus}
        </span>
      </td>
      <td style={{ padding: '20px 0' }}>
        <button 
          className={status === 'drafts_ready' ? "btn-primary" : "btn-secondary"}
          onClick={onReview}
          style={{ padding: '6px 16px', fontSize: '12px' }}
        >
          {status === 'drafts_ready' ? 'Bake-off!' : 'View'}
        </button>
      </td>
    </tr>
  );
}

export default App;
