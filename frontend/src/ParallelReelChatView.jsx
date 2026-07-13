import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Send, CheckCircle, Loader2, ArrowLeft, BrainCircuit } from 'lucide-react';

export default function ParallelReelChatView({ reelId, onBack }) {
  const [reel, setReel] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef(null);

  // The model we test against
  const AI_MODELS = ['gemini'];

  useEffect(() => {
    fetchReel();
    fetchChatHistory();

    // Poll for updates every 3 seconds
    const interval = setInterval(fetchChatHistory, 3000);
    return () => clearInterval(interval);
  }, [reelId]);

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchReel = async () => {
    const { data } = await supabase.from('reels').select('*').eq('id', reelId).single();
    if (data) setReel(data);
  };

  const fetchChatHistory = async () => {
    const { data, error } = await supabase
      .from('reel_chats')
      .select('*')
      .eq('reel_id', reelId)
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
    setLoading(false);
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    
    const messageGroupId = crypto.randomUUID(); // Browser native UUID
    const promptText = inputText;
    setInputText(""); // Optimistic clear

    // 1. Insert User Message
    await supabase.from('reel_chats').insert({
      reel_id: reelId,
      message_group_id: messageGroupId,
      role: 'user',
      content: promptText,
    });

    // 2. Insert 5 Pending AI Messages
    const pendingMessages = AI_MODELS.map(model => ({
      reel_id: reelId,
      message_group_id: messageGroupId,
      role: 'ai',
      model: model,
      content: '', // MUST HAVE EMPTY CONTENT
      status: 'pending'
    }));

    await supabase.from('reel_chats').insert(pendingMessages);

    // Fetch instantly to show loading state
    fetchChatHistory();
  };

  const handleFinalize = async (aiMessage) => {
    if (confirm(`Are you sure you want to finalize the script with ${aiMessage.model}'s draft?`)) {
      await supabase.from('reels').update({
        final_script_content: aiMessage.content,
        status: 'approved',
        master_audio_url: null,
        final_video_url: null
      }).eq('id', reelId);
      
      // Delete old scenes so they don't show up in assets
      await supabase.from('reel_scenes').delete().eq('reel_id', reelId);
      
      alert('Script Finalized! Moving to Director Board.');
      onBack();
    }
  };

  if (loading || !reel) {
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
              Director's Chat: {reel.title}
            </h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>Discuss and refine your script with AI.</p>
          </div>
        </div>
      </div>

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
                {group.ai_responses
                  .filter(ai => ai.status !== 'error') // HIDE ERRORS COMPLETELY
                  .map(ai => (
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
                      <span style={{ fontWeight: '600', textTransform: 'capitalize', fontSize: '14px', color: 'var(--accent-primary)' }}>{ai.model}</span>
                      {ai.status === 'success' && (
                        <button 
                          onClick={() => handleFinalize(ai)}
                          style={{ background: 'rgba(52, 211, 153, 0.2)', color: '#34d399', border: 'none', padding: '4px 12px', borderRadius: '99px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}
                        >
                          <CheckCircle size={12} /> Set Final
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

      {/* Input Box */}
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

    </div>
  );
}
