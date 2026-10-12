import { X } from 'lucide-react';

export default function ConfirmDialog({ 
  isOpen, 
  title, 
  message, 
  icon: Icon,
  confirmText = "Ya", 
  cancelText = "Batal", 
  onConfirm, 
  onCancel,
  confirmColor = "#3b82f6"
}) {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem'
    }}>
      <div style={{
        backgroundColor: 'var(--card-bg)',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        animation: 'slideUp 0.3s ease-out',
        overflow: 'hidden'
      }}>
        <div style={{ padding: '1.5rem', position: 'relative' }}>
          <button 
            onClick={onCancel}
            style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={20} />
          </button>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            {Icon && (
              <div style={{ 
                width: '64px', height: '64px', borderRadius: '50%', 
                backgroundColor: `${confirmColor}15`, color: confirmColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '1rem'
              }}>
                <Icon size={32} />
              </div>
            )}
            
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.25rem', color: 'var(--text-main)', fontWeight: 700 }}>
              {title}
            </h3>
            
            <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {message}
            </p>
          </div>
        </div>
        
        <div style={{ display: 'flex', padding: '1rem', gap: '0.75rem', backgroundColor: 'var(--bg-color)', borderTop: '1px solid var(--border-color)' }}>
          <button 
            onClick={onCancel}
            style={{
              flex: 1, padding: '0.75rem', borderRadius: '8px',
              border: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)',
              color: 'var(--text-main)', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer'
            }}
          >
            {cancelText}
          </button>
          <button 
            onClick={onConfirm}
            style={{
              flex: 1, padding: '0.75rem', borderRadius: '8px',
              border: 'none', backgroundColor: confirmColor,
              color: '#fff', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer'
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
