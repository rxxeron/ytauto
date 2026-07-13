import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { LogIn, UserPlus } from 'lucide-react';

export default function Auth({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage('Check your email for the confirmation link!');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (data.session) {
          onLogin(data.session);
        }
      }
    } catch (error) {
      setMessage(error.error_description || error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-dark)' }}>
      <div className="glass-panel animate-fade-in" style={{ padding: '40px', width: '400px', maxWidth: '90%' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: '28px', margin: '0 0 8px 0' }}>YTAuto Studio</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Sign in to manage AI stories</p>
        </div>

        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>Email</label>
            <input
              type="email"
              placeholder="director@ytauto.com"
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              required
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-light)', color: 'white', outline: 'none' }}
            />
          </div>
          
          {message && (
            <div style={{ padding: '12px', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '8px', fontSize: '13px', color: '#818cf8' }}>
              {message}
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={loading} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
            {isSignUp ? <UserPlus size={18} /> : <LogIn size={18} />}
            {loading ? 'Processing...' : (isSignUp ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          <button 
            type="button" 
            onClick={() => setIsSignUp(!isSignUp)}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px' }}
          >
            {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
}
