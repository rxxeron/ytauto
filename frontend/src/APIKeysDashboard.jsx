import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Activity, Key, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';

const APIKeysDashboard = () => {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchKeys();
    
    // Subscribe to realtime updates
    const channel = supabase
      .channel('api_keys_status_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'api_keys_status' }, (payload) => {
        fetchKeys();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchKeys = async () => {
    const { data, error } = await supabase
      .from('api_keys_status')
      .select('*')
      .order('provider', { ascending: true })
      .order('last_checked', { ascending: false });

    if (!error && data) {
      setKeys(data);
    }
    setLoading(false);
  };

  const getStatusIcon = (status) => {
    if (status === 'Healthy') return <CheckCircle size={20} color="#10b981" />;
    if (status === 'Rate Limited') return <AlertTriangle size={20} color="#f59e0b" />;
    return <XCircle size={20} color="#ef4444" />;
  };

  const getStatusStyle = (status) => {
    if (status === 'Healthy') return { background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' };
    if (status === 'Rate Limited') return { background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)' };
    return { background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' };
  };

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto', color: 'white', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0', background: 'linear-gradient(to right, #60a5fa, #67e8f9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            API Health Dashboard
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Live monitoring of your API Keys and rate limits</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '24px', border: '1px solid var(--border-light)' }}>
          <Activity size={16} color="#60a5fa" />
          <span>Auto-updating every 5 mins</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '24px', border: '1px solid var(--border-light)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ color: 'var(--text-muted)', margin: 0, fontWeight: '500' }}>Total Keys Monitored</h3>
            <Key size={20} color="#60a5fa" />
          </div>
          <p style={{ fontSize: '32px', fontWeight: 'bold', margin: '16px 0 0 0' }}>{keys.length}</p>
        </div>
        
        <div style={{ background: 'rgba(16, 185, 129, 0.05)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ color: '#10b981', margin: 0, fontWeight: '500' }}>Healthy Keys</h3>
            <CheckCircle size={20} color="#10b981" />
          </div>
          <p style={{ fontSize: '32px', fontWeight: 'bold', margin: '16px 0 0 0', color: '#10b981' }}>
            {keys.filter(k => k.status === 'Healthy').length}
          </p>
        </div>

        <div style={{ background: 'rgba(245, 158, 11, 0.05)', borderRadius: '16px', padding: '24px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ color: '#f59e0b', margin: 0, fontWeight: '500' }}>Rate Limited Keys</h3>
            <AlertTriangle size={20} color="#f59e0b" />
          </div>
          <p style={{ fontSize: '32px', fontWeight: 'bold', margin: '16px 0 0 0', color: '#f59e0b' }}>
            {keys.filter(k => k.status === 'Rate Limited').length}
          </p>
        </div>

      </div>

      {/* Table */}
      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid var(--border-light)', overflow: 'hidden' }}>
        <div style={{ padding: '24px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={20} color="#60a5fa" />
            <span>Key Status Log</span>
          </h2>
          <button 
            onClick={fetchKeys}
            className="btn-secondary"
            style={{ padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <RefreshCw size={20} />
          </button>
        </div>
        
        {loading ? (
          <div style={{ padding: '48px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '32px', height: '32px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.2)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  <th style={{ padding: '16px 24px', fontWeight: '500' }}>Provider</th>
                  <th style={{ padding: '16px 24px', fontWeight: '500' }}>Key Prefix</th>
                  <th style={{ padding: '16px 24px', fontWeight: '500' }}>Status</th>
                  <th style={{ padding: '16px 24px', fontWeight: '500' }}>Last Checked</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: k.provider === 'Gemini' ? '#3b82f6' : k.provider === 'OpenAI' ? '#10b981' : '#a855f7' }} />
                        <span style={{ fontWeight: '500' }}>{k.provider}</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{k.key_prefix}</td>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '24px', fontSize: '12px', fontWeight: '600', ...getStatusStyle(k.status) }}>
                        {getStatusIcon(k.status)}
                        <span>{k.status}</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px', color: 'var(--text-muted)', fontSize: '14px' }}>
                      {new Date(k.last_checked).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {keys.length === 0 && (
                  <tr>
                    <td colSpan="4" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No API keys found. Please check your .env file and ensure the python background script is running.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default APIKeysDashboard;
