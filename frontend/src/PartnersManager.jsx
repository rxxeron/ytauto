import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Users, UserCog, Mail, ShieldAlert, Check } from 'lucide-react';

export default function PartnersManager() {
  const [profiles, setProfiles] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [profilesRes, invitesRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('user_invites').select('*').order('created_at', { ascending: false })
    ]);
    if (!profilesRes.error && profilesRes.data) setProfiles(profilesRes.data);
    if (!invitesRes.error && invitesRes.data) setInvites(invitesRes.data);
    setLoading(false);
  };

  const handleInviteUser = async (e) => {
    e.preventDefault();
    if (!inviteEmail) return;
    const { error } = await supabase.from('user_invites').insert([{
      email: inviteEmail,
      role: inviteRole,
      status: 'pending'
    }]);
    if (error) {
      alert("Error sending invite: " + error.message);
    } else {
      setInviteEmail('');
      alert("Invite sent successfully! They will receive an email shortly.");
      fetchData();
    }
  };

  const handleRoleChange = async (profileId, newRole) => {
    if (!window.confirm(`Are you sure you want to change this user's role to ${newRole.toUpperCase()}?`)) return;
    
    // Optimistic update
    setProfiles(profiles.map(p => p.id === profileId ? { ...p, role: newRole } : p));
    
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', profileId);
    if (error) {
      alert("Error updating role: " + error.message);
      fetchProfiles(); // revert on error
    }
  };

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '32px', margin: '0 0 8px 0' }}>Access & Partner Management</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Manage roles and permissions for your team and external partners.</p>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Invite New User</h3>
        <form onSubmit={handleInviteUser} style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Email Address</label>
            <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="partner@example.com" style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', outline: 'none' }} />
          </div>
          <div style={{ width: '200px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Role</label>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', outline: 'none' }}>
              <option value="editor">Editor (Partner)</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" style={{ padding: '12px 24px', height: '44px' }}>
            Send Invite
          </button>
        </form>
      </div>

      <div className="glass-panel">
        {loading ? (
          <p style={{ padding: '24px', color: 'var(--text-muted)' }}>Loading users...</p>
        ) : (profiles.length === 0 && invites.length === 0) ? (
          <p style={{ padding: '24px', color: 'var(--text-muted)' }}>No users found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '16px', fontWeight: '500' }}>Email Address</th>
                <th style={{ padding: '16px', fontWeight: '500' }}>Role (Access Level)</th>
                <th style={{ padding: '16px', fontWeight: '500' }}>Status / Joined</th>
                <th style={{ padding: '16px', fontWeight: '500', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Render Pending Invites First */}
              {invites.filter(inv => inv.status === 'pending').map(invite => (
                <tr key={invite.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                      <Mail size={16} />
                      {invite.email}
                    </div>
                  </td>
                  <td style={{ padding: '16px' }}>
                    <span style={{ 
                      background: 'rgba(255, 255, 255, 0.05)', 
                      color: 'var(--text-secondary)',
                      padding: '4px 10px', 
                      borderRadius: '99px', 
                      fontSize: '12px', 
                      fontWeight: '500'
                    }}>
                      {invite.role.toUpperCase().replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '16px' }}>
                    <span style={{ color: '#fbbf24', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      Pending Invite
                    </span>
                  </td>
                  <td style={{ padding: '16px', textAlign: 'right' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Waiting for signup</span>
                  </td>
                </tr>
              ))}
              
              {/* Render Active Profiles */}
              {profiles.map(profile => (
                <tr key={profile.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Mail size={16} color="var(--text-muted)" />
                      {profile.email || "Unknown"}
                    </div>
                  </td>
                  <td style={{ padding: '16px' }}>
                    <span style={{ 
                      background: profile.role === 'super_admin' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                      color: profile.role === 'super_admin' ? '#818cf8' : 'var(--text-secondary)',
                      padding: '4px 10px', 
                      borderRadius: '99px', 
                      fontSize: '12px', 
                      fontWeight: '500',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {profile.role === 'super_admin' ? <ShieldAlert size={12} /> : <UserCog size={12} />}
                      {profile.role?.toUpperCase().replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '16px', color: 'var(--text-muted)' }}>
                    {new Date(profile.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '16px', textAlign: 'right' }}>
                    {profile.role === 'editor' ? (
                      <button 
                        className="btn-secondary" 
                        onClick={() => handleRoleChange(profile.id, 'super_admin')}
                        style={{ padding: '4px 12px', fontSize: '12px', borderColor: '#6366f1', color: '#818cf8' }}
                      >
                        Promote to Admin
                      </button>
                    ) : (
                      <button 
                        className="btn-secondary" 
                        onClick={() => handleRoleChange(profile.id, 'editor')}
                        style={{ padding: '4px 12px', fontSize: '12px', borderColor: 'rgba(239, 68, 68, 0.5)', color: '#ef4444' }}
                      >
                        Demote to Editor
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
