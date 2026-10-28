import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Sparkles, Loader2 } from 'lucide-react';
import { formatAIProviderStatus, frontendAIClient } from '../services/aiClient';
import AIModelSelector, { useAISelection } from './AIModelSelector';

export default function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: 'bot', text: 'Halo! Aku asisten AI UniMate. Ada tugas atau ide proyek yang ingin didiskusikan hari ini? 💡' }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { selection, setSelection, preferenceStatus } = useAISelection();
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      const response = await frontendAIClient.chat({ message: userMessage, selection });
      if (!response.success) {
        setMessages(prev => [...prev, { role: 'bot', text: 'Maaf, layanan AI belum dapat menyelesaikan permintaan ini.' }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'bot',
          text: response.result.message,
          providerStatus: formatAIProviderStatus(response.meta),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'bot', text: 'Maaf, layanan AI lokal belum tersedia. Fitur lain UniMate tetap dapat digunakan.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="ai-chat-widget">
      {isOpen && (
        <div className="ai-chat-window">
          <div className="ai-chat-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={18} /> UniMate AI
            </div>
            <button aria-label="Tutup UniMate AI" onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>
          
          <div className="ai-chat-messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`ai-message ${msg.role}`}>
                {msg.text}
                {msg.providerStatus && (
                  <small style={{ display: 'block', marginTop: '0.4rem', opacity: 0.7 }}>{msg.providerStatus}</small>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="ai-message bot" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Loader2 size={14} className="animate-spin" /> Sedang berpikir...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <details className="ai-chat-model-settings">
            <summary>Model AI dan privasi</summary>
            <AIModelSelector
              capability="chat"
              input={{ message: input }}
              selection={selection}
              onChange={setSelection}
              preferenceStatus={preferenceStatus}
              compact
              requireConsent
            />
          </details>

          <form className="ai-chat-input-area" onSubmit={handleSend}>
            <input 
              type="text" 
              placeholder="Tanya ide tugas atau jadwal..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isLoading}
            />
            <button
              type="submit"
              className="ai-chat-send"
              aria-label="Kirim pesan ke UniMate AI"
              title={selection.freeTierDataConsent ? 'Kirim pesan' : 'Setujui privasi Free Tier terlebih dahulu'}
              disabled={isLoading || !input.trim() || !selection.freeTierDataConsent}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      {!isOpen && (
        <button className="ai-chat-button" aria-label="Buka UniMate AI" onClick={() => setIsOpen(true)}>
          <MessageSquare size={24} />
        </button>
      )}
    </div>
  );
}
