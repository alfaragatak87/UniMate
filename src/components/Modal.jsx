import { X } from 'lucide-react';

export default function Modal({ isOpen, onClose, title, children, width }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: width || '500px' }}>
        <div className="modal-header flex-between">
          <h3>{title}</h3>
          <button onClick={onClose} className="btn-icon">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}
