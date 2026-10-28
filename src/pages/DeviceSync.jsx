import { useState, useEffect, useRef } from 'react';
import { Laptop, RefreshCw, UploadCloud, Link as LinkIcon, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Peer from 'peerjs';
import { createDeviceSyncPreview, createDeviceSyncRejection } from '../services/deviceSyncSafety';

export default function DeviceSync() {
  const [peerId, setPeerId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [connectedPeer, setConnectedPeer] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // disconnected, connecting, connected
  const [syncPreview, setSyncPreview] = useState(null);
  const peerInstance = useRef(null);
  const connInstance = useRef(null);

  useEffect(() => {
    const peer = new Peer();

    peer.on('open', (id) => {
      setPeerId(id);
    });

    peer.on('connection', (conn) => {
      setupConnectionListeners(conn);
      conn.on('open', () => {
        connInstance.current = conn;
        setConnectedPeer(conn.peer);
        setConnectionStatus('connected');
        toast.success('Kanal peer terhubung. Identitas perangkat belum terverifikasi.');
      });
    });

    peer.on('error', () => {
      toast.error('Gagal terhubung ke jaringan PeerJS.');
      setConnectionStatus('disconnected');
    });

    peerInstance.current = peer;

    return () => {
      connInstance.current?.close();
      if (peerInstance.current) {
        peerInstance.current.destroy();
      }
    };
  }, []);

  const setupConnectionListeners = (conn) => {
    conn.on('data', (data) => {
      if (data?.type === 'SYNC_REJECTED') {
        toast.error('Perangkat tujuan menolak transfer. Tidak ada data yang diubah.');
        return;
      }
      try {
        const preview = createDeviceSyncPreview(data, localStorage);
        setSyncPreview(preview);
        conn.send(createDeviceSyncRejection(preview.requestId));
        toast('Preview diterima, tetapi penulisan ditolak karena pairing aman belum tersedia.', { icon: 'ℹ️' });
      } catch {
        conn.send(createDeviceSyncRejection(data?.requestId, 'invalid_message'));
        toast.error('Pesan sinkronisasi tidak valid dan ditolak.');
      }
    });

    conn.on('close', () => {
      setConnectedPeer(null);
      setConnectionStatus('disconnected');
      toast('Koneksi terputus.', { icon: 'ℹ️' });
    });
  };

  const connectToPeer = () => {
    if (!targetId.trim()) {
      toast.error('Masukkan ID Tujuan terlebih dahulu.');
      return;
    }
    
    setConnectionStatus('connecting');
    const conn = peerInstance.current.connect(targetId);
    
    conn.on('open', () => {
      connInstance.current = conn;
      setConnectedPeer(targetId);
      setConnectionStatus('connected');
      toast.success('Kanal peer terhubung. Identitas perangkat belum terverifikasi.');
      setupConnectionListeners(conn);
    });

    conn.on('error', (_err) => {
      toast.error('Gagal menghubungi perangkat tujuan.');
      setConnectionStatus('disconnected');
    });
  };

  const pushData = () => {
    if (!connInstance.current || connectionStatus !== 'connected') {
      toast.error('Belum ada perangkat yang terhubung.');
      return;
    }

    toast.error('Transfer data dinonaktifkan sampai autentikasi perangkat, persetujuan penerima, dan ACK aman tersedia.');
  };

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <div>
          <h1 className="page-title">Device Sync <RefreshCw size={28} style={{ color: 'var(--primary-color)' }} /></h1>
          <p className="page-subtitle">Koneksi peer-to-peer eksperimental. Proses signaling dapat memakai layanan jaringan dan transfer data aman belum diaktifkan.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
        {/* Device Identity */}
        <div className="dashboard-card" style={{ padding: '2rem', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: 'var(--primary-color)' }}>
            <Laptop size={64} />
          </div>
          <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-main)' }}>ID Perangkat Ini</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Berikan ID ini ke perangkat lain untuk terhubung secara peer-to-peer.</p>
          
          <div style={{ 
            background: 'var(--bg-color)', 
            padding: '1rem', 
            borderRadius: '8px', 
            border: '2px dashed var(--border-color)',
            fontSize: '1.5rem',
            fontWeight: 'bold',
            letterSpacing: '2px',
            color: 'var(--text-main)'
          }}>
            {peerId || 'Memuat ID...'}
          </div>
        </div>

        {/* Connection Panel */}
        <div className="dashboard-card" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LinkIcon size={20} /> Hubungkan Perangkat
          </h3>

          {connectionStatus === 'connected' ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: '#10b981' }}>
                <CheckCircle size={48} />
              </div>
              <h4 style={{ color: '#10b981', marginBottom: '0.5rem' }}>Kanal terhubung dengan {connectedPeer}</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Identitas belum terverifikasi. Tidak ada data lokal yang akan dikirim atau ditulis.</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <button className="btn btn-primary" onClick={pushData} style={{ padding: '1rem', fontSize: '1rem', width: '100%', justifyContent: 'center' }}>
                  <UploadCloud size={20} /> Transfer Aman Belum Aktif
                </button>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                  Transfer data dinonaktifkan sampai autentikasi perangkat, persetujuan penerima, preview konflik, dan ACK aman tersedia.
                </p>
                {syncPreview && (
                  <div style={{ textAlign: 'left', padding: '0.9rem', borderRadius: '8px', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.85rem' }}>
                    <strong>Preview ditolak dengan aman</strong>
                    <p style={{ margin: '0.5rem 0' }}>Key: {syncPreview.keys.join(', ') || 'tidak ada'}</p>
                    <p style={{ margin: 0 }}>Tambahan {syncPreview.additions}, berbeda {syncPreview.differences}, sama {syncPreview.unchanged}, konflik {syncPreview.conflicts}. Tidak ada data yang ditulis.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="form-group">
                <label>Masukkan ID Perangkat Lawan (HP/Laptop)</label>
                <div className="mobile-col" style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="misal: unimate-1234" 
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button 
                    className="btn btn-primary" 
                    onClick={connectToPeer}
                    disabled={connectionStatus === 'connecting'}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {connectionStatus === 'connecting' ? 'Menghubungkan...' : 'Koneksikan'}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: 'var(--bg-color)', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                <h5 style={{ margin: '0 0 0.5rem 0', color: '#b45309', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertCircle size={16} /> Cara Penggunaan
                </h5>
                <ol style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <li>Buka aplikasi UniMate di HP dan Laptop secara bersamaan.</li>
                  <li>Di HP Anda, masukkan <strong>ID Perangkat</strong> yang tertera di layar Laptop.</li>
                  <li>Klik <strong>Koneksikan</strong>.</li>
                  <li>Koneksi saat ini hanya untuk verifikasi kanal. Transfer data tetap diblokir sampai protokol pairing aman tersedia.</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
