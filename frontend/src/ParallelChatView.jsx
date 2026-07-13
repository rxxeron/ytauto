import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Send, CheckCircle, Loader2, ArrowLeft, BrainCircuit } from 'lucide-react';

export default function ParallelChatView({ episodeId, onBack }) {
  const [episode, setEpisode] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'specifics'
  const [selectedDrafts, setSelectedDrafts] = useState([]); // Array of ai message objects
  
  // Specifics form state
  const [bgmPrompt, setBgmPrompt] = useState("");
  const [episodeCharacters, setEpisodeCharacters] = useState([]);
  const [newChar, setNewChar] = useState({ name: '', elevenlabs_voice_id: '', visual_description: '' });
  
  const messagesEndRef = useRef(null);

  // The models we test against
  const AI_MODELS = ['gemini'];

  useEffect(() => {
    fetchEpisode();
    fetchChatHistory();

    // Poll for updates every 3 seconds
    const interval = setInterval(fetchChatHistory, 3000);
    return () => clearInterval(interval);
  }, [episodeId]);

  useEffect(() => {
    scrollToBottom();
  }, [activeTab]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchEpisode = async () => {
    const { data } = await supabase.from('episodes').select('*').eq('id', episodeId).single();
    if (data) {
      setEpisode(data);
      setBgmPrompt(data.bgm_prompt || "");
    }
  };

  const fetchEpisodeCharacters = async () => {
    const { data } = await supabase.from('characters').select('*').eq('episode_id', episodeId);
    if (data) setEpisodeCharacters(data);
  };

  const fetchChatHistory = async () => {
    const { data, error } = await supabase
      .from('episode_chats')
      .select('*')
      .eq('episode_id', episodeId)
      .order('created_at', { ascending: true });
      
    if (data) {
      // Group messages by message_group_id to render them cleanly
      const groups = {};
      data.forEach(msg => {
        if (!groups[msg.message_group_id]) {
          groups[msg.message_group_id] = { user: null, ai_responses: [] };
        }
        if (msg.role === 'user') {
          groups[msg.message_group_id].user = msg;
        } else {
          groups[msg.message_group_id].ai_responses.push(msg);
        }
      });
      
      // Convert to ordered array
      const groupedArray = Object.values(groups).sort((a, b) => {
        return new Date(a.user?.created_at) - new Date(b.user?.created_at);
      });
      
      setChatHistory(groupedArray);
    }
    
    // Also fetch chars here to keep them fresh
    fetchEpisodeCharacters();
    setLoading(false);
  };

  const saveBgmPrompt = async () => {
    await supabase.from('episodes').update({ bgm_prompt: bgmPrompt }).eq('id', episodeId);
    alert('BGM Prompt saved successfully!');
  };

  const addEpisodeCharacter = async () => {
    if (!newChar.name || !newChar.visual_description) return;
    
    await supabase.from('characters').insert({
      series_id: episode.series_id,
      episode_id: episodeId,
      name: newChar.name,
      elevenlabs_voice_id: newChar.elevenlabs_voice_id,
      visual_description: newChar.visual_description
    });
    
    setNewChar({ name: '', elevenlabs_voice_id: '', visual_description: '' });
    fetchEpisodeCharacters();
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    
    const messageGroupId = crypto.randomUUID(); // Browser native UUID
    const promptText = inputText;
    setInputText(""); // Optimistic clear

    // 1. Insert User Message
    await supabase.from('episode_chats').insert({
      episode_id: episodeId,
      message_group_id: messageGroupId,
      role: 'user',
      content: promptText,
    });

    // 2. Insert 5 Pending AI Messages
    const pendingMessages = AI_MODELS.map(model => ({
      episode_id: episodeId,
      message_group_id: messageGroupId,
      role: 'ai',
      model: model,
      status: 'pending'
    }));

    await supabase.from('episode_chats').insert(pendingMessages);

    // Fetch instantly to show loading state
    fetchChatHistory();
  };

  const handleToggleDraft = (aiMessage) => {
    setSelectedDrafts(prev => {
      const isSelected = prev.some(d => d.id === aiMessage.id);
      if (isSelected) {
        return prev.filter(d => d.id !== aiMessage.id);
      } else {
        return [...prev, aiMessage];
      }
    });
  };

  const handleMergeAndRefine = async () => {
    if (selectedDrafts.length === 0) return;
    
    // Construct the prompt
    let promptText = "Please merge the following drafts into a single, cohesive, highly-polished script. Maintain the standard format:\n\n";
    selectedDrafts.forEach((draft, idx) => {
      promptText += `--- DRAFT ${idx + 1} (${draft.model}) ---\n${draft.content}\n\n`;
    });
    
    const messageGroupId = crypto.randomUUID();
    
    // Insert User Message
    await supabase.from('episode_chats').insert({
      episode_id: episodeId,
      message_group_id: messageGroupId,
      role: 'user',
      content: promptText,
    });

    // Insert only ONE pending message for Gemini
    await supabase.from('episode_chats').insert({
      episode_id: episodeId,
      message_group_id: messageGroupId,
      role: 'ai',
      model: 'gemini',
      status: 'pending'
    });

    setSelectedDrafts([]);
    fetchChatHistory();
    scrollToBottom();
  };

  const handleRetry = async (aiMessage) => {
    await supabase.from('episode_chats').update({
      status: 'pending',
      content: ''
    }).eq('id', aiMessage.id);
    fetchChatHistory();
  };

  const handleFinalize = async (aiMessage) => {
    if (confirm(`Are you sure you want to finalize the script with ${aiMessage.model}'s draft?`)) {
      await supabase.from('episodes').update({
        final_script_content: aiMessage.content,
        status: 'generating_prompts'
      }).eq('id', episodeId);
      
      alert('Script Finalized! AI is now breaking it down into scenes.');
      onBack();
    }
  };

  if (loading || !episode) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column' }}>
        <Loader2 className="spin" size={32} color="var(--accent-primary)" />
        <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Loading Multi-Model Director's Chat...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '80vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onBack} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <BrainCircuit color="var(--accent-primary)" /> 
              Director's Chat: {episode.title}
            </h2>
            <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
              <button 
                onClick={() => setActiveTab('chat')} 
                style={{ background: 'none', border: 'none', color: activeTab === 'chat' ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: '600', cursor: 'pointer', padding: 0 }}
              >
                Story Brainstorming
              </button>
              <button 
                onClick={() => setActiveTab('specifics')} 
                style={{ background: 'none', border: 'none', color: activeTab === 'specifics' ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: '600', cursor: 'pointer', padding: 0 }}
              >
                Episode Specifics
              </button>
            </div>
          </div>
        </div>
      </div>

      {activeTab === 'specifics' ? (
        <div className="glass-panel animate-fade-in" style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px', marginBottom: '24px' }}>
          
          {/* BGM Override */}
          <div>
            <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Manual BGM Override</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
              Normally, the AI generates a BGM prompt based on the episode's plot. You can override it here.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input 
                type="text" 
                value={bgmPrompt}
                onChange={(e) => setBgmPrompt(e.target.value)}
                placeholder="e.g. intense synthwave chase music with heavy bass"
                style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white' }}
              />
              <button className="btn-primary" onClick={saveBgmPrompt}>Save BGM</button>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)' }} />

          {/* Episode Characters */}
          <div>
            <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Episode Guest Characters</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
              Add characters that only appear in this episode. They will be available during generation.
            </p>
            
            {episodeCharacters.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
                {episodeCharacters.map(char => (
                  <div key={char.id} style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', width: '250px' }}>
                    <div style={{ fontWeight: 'bold' }}>{char.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Voice: {char.elevenlabs_voice_id || 'Auto'}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>{char.visual_description}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px' }}>
              <h4 style={{ margin: 0, fontSize: '14px' }}>Add New Guest Character</h4>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input 
                  type="text" placeholder="Character Name" 
                  value={newChar.name} onChange={e => setNewChar({...newChar, name: e.target.value})}
                  style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white' }}
                />
                <input 
                  type="text" placeholder="Voice ID (optional)" 
                  value={newChar.elevenlabs_voice_id} onChange={e => setNewChar({...newChar, elevenlabs_voice_id: e.target.value})}
                  style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white' }}
                />
              </div>
              <textarea 
                placeholder="Visual Description (e.g. 20yo, green eyes, wearing a hoodie)"
                value={newChar.visual_description} onChange={e => setNewChar({...newChar, visual_description: e.target.value})}
                rows={2}
                style={{ padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white', resize: 'none' }}
              />
              <button className="btn-secondary" onClick={addEpisodeCharacter} style={{ alignSelf: 'flex-start' }}>Add Character</button>
            </div>
          </div>
          
        </div>
      ) : (
        <>
          {/* Chat History Container */}
          <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px', marginBottom: '24px' }}>
        
        {chatHistory.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', maxWidth: '400px' }}>
            <BrainCircuit size={48} style={{ margin: '0 auto 16px auto', opacity: 0.5 }} />
            <h3>Start the Brainstorming!</h3>
            <p>Send a prompt below, and Gemini will write a script for you.</p>
          </div>
        ) : (
          chatHistory.map((group, index) => (
            <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* User Message */}
              {group.user && (
                <div style={{ alignSelf: 'flex-end', background: 'var(--accent-primary)', padding: '16px 20px', borderRadius: '16px 16px 4px 16px', maxWidth: '80%', color: 'white', fontSize: '15px', lineHeight: '1.5' }}>
                  {group.user.content}
                </div>
              )}

              {/* AI Responses Grid */}
              <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
                {group.ai_responses.map(ai => (
                  <div key={ai.id} style={{ 
                    flex: '0 0 350px', 
                    background: 'rgba(255,255,255,0.03)', 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    borderRadius: '16px', 
                    display: 'flex', 
                    flexDirection: 'column',
                    overflow: 'hidden'
                  }}>
                    {/* Model Header */}
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {ai.status === 'success' && (
                          <input 
                            type="checkbox" 
                            checked={selectedDrafts.some(d => d.id === ai.id)}
                            onChange={() => handleToggleDraft(ai)}
                            style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                          />
                        )}
                        <span style={{ fontWeight: '600', textTransform: 'capitalize', fontSize: '14px', color: 'var(--accent-primary)' }}>{ai.model}</span>
                      </div>
                      {ai.status === 'success' && (
                        <button 
                          onClick={() => handleFinalize(ai)}
                          style={{ background: 'rgba(52, 211, 153, 0.2)', color: '#34d399', border: 'none', padding: '4px 12px', borderRadius: '99px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}
                        >
                          <CheckCircle size={12} /> Set Final
                        </button>
                      )}
                      {ai.status === 'error' && (
                        <button 
                          onClick={() => handleRetry(ai)}
                          style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: 'none', padding: '4px 12px', borderRadius: '99px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                    
                    {/* Message Content */}
                    <div style={{ padding: '16px', fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)', flex: 1, overflowY: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap' }}>
                      {ai.status === 'pending' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100px', color: 'var(--text-muted)' }}>
                          <Loader2 className="spin" size={20} style={{ marginBottom: '8px' }} />
                          Thinking...
                        </div>
                      ) : (
                        ai.content
                      )}
                    </div>
                  </div>
                ))}
              </div>

            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

        </>
      )}

      {/* Floating Merge Toolbar */}
      {selectedDrafts.length > 0 && activeTab === 'chat' && (
        <div style={{
          position: 'fixed',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--accent-primary)',
          padding: '12px 24px',
          borderRadius: '99px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 100
        }} className="animate-fade-in">
          <span style={{ fontWeight: '600' }}>{selectedDrafts.length} drafts selected</span>
          <button 
            onClick={handleMergeAndRefine}
            style={{ 
              background: 'white', 
              color: 'var(--accent-primary)', 
              border: 'none', 
              padding: '8px 16px', 
              borderRadius: '99px', 
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <BrainCircuit size={16} /> Merge & Refine with Gemini
          </button>
        </div>
      )}

      {/* Input Box (Only show in Chat mode) */}
      {activeTab === 'chat' && (
        <div className="glass-panel" style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
          <textarea 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your prompt here (e.g., 'Make the ending more dramatic...')"
            style={{
              flex: 1,
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              padding: '16px',
              color: 'white',
              outline: 'none',
              resize: 'none',
              minHeight: '24px',
              fontSize: '15px'
            }}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
          />
          <button 
            className="btn-primary" 
            onClick={handleSendMessage}
            disabled={!inputText.trim()}
            style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '56px', width: '56px', borderRadius: '12px' }}
          >
            <Send size={20} />
          </button>
        </div>
      )}

    </div>
  );
}
