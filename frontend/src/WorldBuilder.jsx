import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Save, Plus, User, Image as ImageIcon, Volume2, MessageSquare, BookOpen, Send, Loader2, BrainCircuit, RefreshCw } from 'lucide-react';

export default function WorldBuilder({ series, onBack }) {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'bible'

  // --- BIBLE STATE ---
  const [positivePrompt, setPositivePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewCharForm, setShowNewCharForm] = useState(false);
  const [newChar, setNewChar] = useState({ name: '', visual_description: '', elevenlabs_voice_id: '', view_front_url: '', view_left_url: '', view_right_url: '', view_back_url: '' });

  // --- CHAT STATE ---
  const [chatHistory, setChatHistory] = useState([]);
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchWorldData();
    fetchChatHistory();
    const interval = setInterval(() => {
      fetchChatHistory();
      // Also occasionally refresh characters in case the AI added one
      fetchCharactersSilently();
    }, 3000);
    return () => clearInterval(interval);
  }, [series]);

  const prevChatHistoryStr = useRef('');

  useEffect(() => {
    const currentStr = JSON.stringify(chatHistory);
    if (currentStr !== prevChatHistoryStr.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      prevChatHistoryStr.current = currentStr;
    }
  }, [chatHistory]);

  const fetchWorldData = async () => {
    setLoading(true);
    const { data: seriesData } = await supabase.from('series').select('*').eq('id', series.id).single();
    if (seriesData) {
      setPositivePrompt(seriesData.global_positive_prompt || '');
      setNegativePrompt(seriesData.global_negative_prompt || '');
    }
    await fetchCharactersSilently();
    setLoading(false);
  };

  const fetchCharactersSilently = async () => {
    const { data: chars } = await supabase.from('characters').select('*').eq('series_id', series.id).order('created_at', { ascending: true });
    if (chars) setCharacters(chars);
  };

  const fetchChatHistory = async () => {
    const { data, error } = await supabase
      .from('world_builder_chats')
      .select('*')
      .eq('series_id', series.id)
      .order('created_at', { ascending: true });
    if (data) setChatHistory(data);
  };

  const savePrompts = async () => {
    const { error } = await supabase.from('series').update({
      global_positive_prompt: positivePrompt,
      global_negative_prompt: negativePrompt
    }).eq('id', series.id);
    if (!error) alert("World constraints saved!");
  };

  const handleCreateCharacter = async () => {
    if (!newChar.name || !newChar.visual_description) {
      alert("Name and Visual Description are required!");
      return;
    }
    const { data, error } = await supabase.from('characters').insert({
      series_id: series.id,
      name: newChar.name,
      visual_description: newChar.visual_description,
      elevenlabs_voice_id: newChar.elevenlabs_voice_id,
      view_front_url: newChar.view_front_url,
      view_left_url: newChar.view_left_url,
      view_right_url: newChar.view_right_url,
      view_back_url: newChar.view_back_url
    }).select().single();

    if (!error) {
      setCharacters([...characters, data]);
      setShowNewCharForm(false);
      setNewChar({ name: '', visual_description: '', elevenlabs_voice_id: '', view_front_url: '', view_left_url: '', view_right_url: '', view_back_url: '' });
    }
  };

  const handleRegenerateImage = async (char, angle) => {
    // Show a temporary loading state
    const angleKey = `view_${angle}_url`;
    const updatedChars = characters.map(c => 
      c.id === char.id ? { ...c, [angleKey]: '' } : c
    );
    setCharacters(updatedChars);
    
    try {
      // Instead of an API, we just set the URL to empty in DB, and set a status flag for orchestrator to pick up
      const { error } = await supabase.from('characters').update({
        [angleKey]: ''
      }).eq('id', char.id);
      
      if (error) throw error;
      
      // Send a hidden chat message to the orchestrator to trigger the regeneration
      await supabase.from('world_builder_chats').insert({
        series_id: series.id,
        role: 'user',
        content: `[REGENERATE_IMAGE] CharID:${char.id} | Angle:${angle}`,
        status: 'pending'
      });
      
    } catch (e) {
      console.error(e);
      // Revert on error
      setCharacters(characters);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    const promptText = inputText;
    setInputText("");
    
    // User message
    await supabase.from('world_builder_chats').insert({
      series_id: series.id,
      role: 'user',
      content: promptText,
    });

    // AI pending message (we will use Gemini for world building)
    await supabase.from('world_builder_chats').insert({
      series_id: series.id,
      role: 'ai',
      model: 'gemini',
      status: 'pending',
      content: ''
    });

    fetchChatHistory();
  };

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading World Builder...</div>;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '80vh' }}>
      
      {/* TABS */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>
        <button 
          onClick={() => setActiveTab('chat')}
          style={{ 
            background: 'none', border: 'none', color: activeTab === 'chat' ? 'var(--accent-primary)' : 'var(--text-secondary)', 
            fontSize: '16px', fontWeight: activeTab === 'chat' ? '600' : '400', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' 
          }}
        >
          <MessageSquare size={18} /> Brainstorming AI
        </button>
        <button 
          onClick={() => setActiveTab('bible')}
          style={{ 
            background: 'none', border: 'none', color: activeTab === 'bible' ? 'var(--accent-primary)' : 'var(--text-secondary)', 
            fontSize: '16px', fontWeight: activeTab === 'bible' ? '600' : '400', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' 
          }}
        >
          <BookOpen size={18} /> Characters & Prompts
        </button>
      </div>

      {activeTab === 'chat' ? (
        // --- CHAT TAB ---
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '24px' }}>
            {chatHistory.length === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', maxWidth: '500px' }}>
                <BrainCircuit size={48} style={{ margin: '0 auto 16px auto', opacity: 0.5 }} />
                <h3>Welcome to the Director's Brainstorming Room</h3>
                <p>Chat with the AI Showrunner to plan out a 15-episode arc, establish the lore, and design your characters. When you finalize a character, the AI will automatically add them to the Series Bible and generate their reference art!</p>
              </div>
            ) : (
              chatHistory.map(msg => (
                <div key={msg.id} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                  <div style={{ 
                    background: msg.role === 'user' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)', 
                    padding: '16px 20px', 
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', 
                    color: 'white', fontSize: '15px', lineHeight: '1.5',
                    border: msg.role === 'ai' ? '1px solid var(--border-light)' : 'none',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {msg.status === 'pending' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                        <Loader2 className="spin" size={16} /> Thinking...
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="glass-panel" style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
            <textarea 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="e.g., Let's plan a 15 episode sci-fi arc. First, pitch me the main protagonist..."
              style={{ flex: 1, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '16px', color: 'white', outline: 'none', resize: 'none', minHeight: '24px', fontSize: '15px' }}
              rows={3}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
            />
            <button className="btn-primary" onClick={handleSendMessage} disabled={!inputText.trim()} style={{ padding: '16px', height: '56px', width: '56px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Send size={20} />
            </button>
          </div>
        </div>
      ) : (
        // --- BIBLE TAB ---
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', overflowY: 'auto' }}>
          
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', color: '#8b5cf6' }}>Global Art Style & Prompts</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>Global Positive Prompt</label>
                <textarea value={positivePrompt} onChange={(e) => setPositivePrompt(e.target.value)} style={{ width: '100%', height: '80px', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(139, 92, 246, 0.3)', color: 'white', borderRadius: '8px', resize: 'vertical' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>Global Negative Prompt</label>
                <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} style={{ width: '100%', height: '80px', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'white', borderRadius: '8px', resize: 'vertical' }} />
              </div>
              <button className="btn-primary" onClick={savePrompts} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px', background: '#8b5cf6' }}>
                <Save size={16} /> Save Prompts
              </button>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#3b82f6' }}>Character Profiles (Series Bible)</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>The AI in the Brainstorming Chat can automatically add characters here.</p>
              </div>
              <button className="btn-primary" onClick={() => setShowNewCharForm(!showNewCharForm)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={16} /> Manual Add
              </button>
            </div>

            {showNewCharForm && (
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '12px', marginBottom: '24px', border: '1px solid #3b82f6' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '16px' }}>New Character</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <input type="text" value={newChar.name} onChange={(e) => setNewChar({...newChar, name: e.target.value})} placeholder="Name (e.g., Alex)" style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }} />
                  <input type="text" value={newChar.elevenlabs_voice_id} onChange={(e) => setNewChar({...newChar, elevenlabs_voice_id: e.target.value})} placeholder="Voice ID" style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }} />
                </div>
                <textarea value={newChar.visual_description} onChange={(e) => setNewChar({...newChar, visual_description: e.target.value})} placeholder="Visual Description..." style={{ width: '100%', height: '60px', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px', resize: 'vertical', marginBottom: '16px' }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                  <input type="text" value={newChar.view_front_url} onChange={(e) => setNewChar({...newChar, view_front_url: e.target.value})} placeholder="Front Image URL..." style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }} />
                  <input type="text" value={newChar.view_left_url} onChange={(e) => setNewChar({...newChar, view_left_url: e.target.value})} placeholder="Left Image URL..." style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }} />
                  <input type="text" value={newChar.view_right_url} onChange={(e) => setNewChar({...newChar, view_right_url: e.target.value})} placeholder="Right Image URL..." style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }} />
                  <input type="text" value={newChar.view_back_url} onChange={(e) => setNewChar({...newChar, view_back_url: e.target.value})} placeholder="Back Image URL..." style={{ width: '100%', padding: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px' }} />
                </div>
                <button className="btn-primary" onClick={handleCreateCharacter}>Save</button>
              </div>
            )}

            {characters.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', border: '1px dashed var(--border-light)', borderRadius: '12px' }}>No characters yet.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {characters.map(char => (
                  <div key={char.id} style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-light)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '20px', background: 'rgba(59, 130, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6', overflow: 'hidden' }}>
                        {char.view_front_url ? <img src={char.view_front_url} alt={char.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={20} />}
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '16px' }}>{char.name}</h4>
                        {char.elevenlabs_voice_id && <div style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}><Volume2 size={12} /> {char.elevenlabs_voice_id.substring(0, 8)}...</div>}
                      </div>
                    </div>
                    {/* Character Turnaround Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                      <div style={{ aspectRatio: '1/1', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }} className="image-container">
                        {char.view_front_url && <img src={char.view_front_url} alt="Front" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: '9px', background: 'rgba(0,0,0,0.7)', padding: '2px 4px', borderRadius: '2px' }}>Front</div>
                        <button className="regenerate-btn" onClick={() => handleRegenerateImage(char, 'front')} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'none' }}><RefreshCw size={12} /></button>
                      </div>
                      <div style={{ aspectRatio: '1/1', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }} className="image-container">
                        {char.view_left_url && <img src={char.view_left_url} alt="Left" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: '9px', background: 'rgba(0,0,0,0.7)', padding: '2px 4px', borderRadius: '2px' }}>Left</div>
                        <button className="regenerate-btn" onClick={() => handleRegenerateImage(char, 'left')} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'none' }}><RefreshCw size={12} /></button>
                      </div>
                      <div style={{ aspectRatio: '1/1', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }} className="image-container">
                        {char.view_right_url && <img src={char.view_right_url} alt="Right" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: '9px', background: 'rgba(0,0,0,0.7)', padding: '2px 4px', borderRadius: '2px' }}>Right</div>
                        <button className="regenerate-btn" onClick={() => handleRegenerateImage(char, 'right')} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'none' }}><RefreshCw size={12} /></button>
                      </div>
                      <div style={{ aspectRatio: '1/1', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }} className="image-container">
                        {char.view_back_url && <img src={char.view_back_url} alt="Back" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: '9px', background: 'rgba(0,0,0,0.7)', padding: '2px 4px', borderRadius: '2px' }}>Back</div>
                        <button className="regenerate-btn" onClick={() => handleRegenerateImage(char, 'back')} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'none' }}><RefreshCw size={12} /></button>
                      </div>
                      <style>{`
                        .image-container:hover .regenerate-btn {
                          display: block !important;
                        }
                        .regenerate-btn:hover {
                          background: rgba(59, 130, 246, 0.8) !important;
                        }
                      `}</style>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px' }}>
                      {char.visual_description}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
