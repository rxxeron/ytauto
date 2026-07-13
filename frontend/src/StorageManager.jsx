import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Trash2, File, Database, Download } from 'lucide-react';

export default function StorageManager({ userRole }) {
  const [files, setFiles] = useState([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);

  // Free tier Supabase Storage Limit (1 GB = 1073741824 bytes)
  const STORAGE_LIMIT = 1073741824;
  
  useEffect(() => {
    fetchStorageFiles();
  }, []);

  const fetchStorageFiles = async () => {
    setLoading(true);
    try {
      // Supabase list files in 'media' bucket, empty path '' gets root files
      // We will fetch from 'audio' and 'videos' folders
      const { data: audioData, error: audioErr } = await supabase.storage.from('media').list('audio');
      const { data: videoData, error: videoErr } = await supabase.storage.from('media').list('videos');
      
      let allFiles = [];
      if (audioData) {
        allFiles = [...allFiles, ...audioData.map(f => ({...f, path: `audio/${f.name}`}))];
      }
      if (videoData) {
        allFiles = [...allFiles, ...videoData.map(f => ({...f, path: `videos/${f.name}`}))];
      }
      
      // Filter out standard .emptyFolder placeholders if they exist
      allFiles = allFiles.filter(f => f.name !== '.emptyFolder' && f.id);
      
      // Sort by created at, newest first
      allFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setFiles(allFiles);

      // Calculate total size
      const total = allFiles.reduce((acc, file) => acc + (file.metadata?.size || 0), 0);
      setTotalSize(total);
    } catch (err) {
      console.error("Storage fetch error:", err);
    }
    setLoading(false);
  };

  const handleDelete = async (filePath) => {
    if (userRole !== 'super_admin') {
      alert("Only Super Admins can delete storage files.");
      return;
    }
    
    if (!window.confirm(`Are you sure you want to delete ${filePath}? This action cannot be undone and will break videos using this file.`)) {
      return;
    }
    
    const { error } = await supabase.storage.from('media').remove([filePath]);
    if (error) {
      alert("Error deleting file: " + error.message);
    } else {
      fetchStorageFiles();
    }
  };

  const getPublicUrl = (path) => {
    const { data } = supabase.storage.from('media').getPublicUrl(path);
    return data.publicUrl;
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '32px', margin: '0 0 8px 0' }}>Cloud Storage Manager</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Monitor and clean up your Azure/Supabase cloud media storage bucket.</p>
        </div>
        <button onClick={fetchStorageFiles} className="btn-secondary">
          Refresh Storage
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Storage Quota Used</span>
          <span style={{ fontSize: '14px', fontWeight: '500' }}>
            {formatBytes(totalSize)} / {formatBytes(STORAGE_LIMIT)}
          </span>
        </div>
        <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '99px', overflow: 'hidden' }}>
          <div style={{ 
            height: '100%', 
            background: totalSize / STORAGE_LIMIT > 0.9 ? '#ef4444' : totalSize / STORAGE_LIMIT > 0.7 ? '#fbbf24' : '#3b82f6',
            width: `${Math.min((totalSize / STORAGE_LIMIT) * 100, 100)}%`,
            transition: 'width 0.5s ease'
          }} />
        </div>
      </div>

      <div className="glass-panel">
        {loading ? (
          <p style={{ padding: '24px', color: 'var(--text-muted)' }}>Scanning cloud storage...</p>
        ) : files.length === 0 ? (
          <p style={{ padding: '24px', color: 'var(--text-muted)' }}>No media files found in cloud storage.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '16px', fontWeight: '500' }}>File Name</th>
                <th style={{ padding: '16px', fontWeight: '500' }}>Size</th>
                <th style={{ padding: '16px', fontWeight: '500' }}>Created At</th>
                <th style={{ padding: '16px', fontWeight: '500', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map(file => (
                <tr key={file.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ padding: '8px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', color: '#3b82f6' }}>
                        <Database size={16} />
                      </div>
                      <div>
                        <div style={{ fontWeight: '500', fontSize: '14px' }}>{file.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{file.path.split('/')[0].toUpperCase()}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    {formatBytes(file.metadata?.size || 0)}
                  </td>
                  <td style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    {new Date(file.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <a href={getPublicUrl(file.path)} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ padding: '6px' }} title="Download">
                        <Download size={16} />
                      </a>
                      {userRole === 'super_admin' && (
                        <button onClick={() => handleDelete(file.path)} className="btn-danger" style={{ padding: '6px' }} title="Delete File">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
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
