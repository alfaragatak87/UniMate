import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MessageSquare, X, Send, Sparkles, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const { apiKey } = useAppContext();
  const [messages, setMessages] = useState([{ role: 'bot', text: 'Halo! Aku asisten AI UniMate. Ada tugas atau ide proyek yang ingin didiskusikan hari ini? 💡' }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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

    if (!apiKey) {
      toast.error('API Key Gemini belum diatur! Silakan atur di Settings.');
      return;
    }

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const prompt = `Kamu adalah asisten AI yang cerdas, ramah, dan membantu khusus untuk aplikasi manajemen kuliah "UniMate". 
Berikan respons yang ringkas dan memotivasi untuk pertanyaan berikut:
${userMessage}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      setMessages(prev => [...prev, { role: 'bot', text }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'bot', text: 'Maaf, terjadi kesalahan saat menyambung ke server AI. Pastikan API Key Anda valid dan koneksi internet stabil.' }]);
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
            <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>
          
          <div className="ai-chat-messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`ai-message ${msg.role}`}>
                {msg.text}
              </div>
            ))}
            {isLoading && (
              <div className="ai-message bot" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Loader2 size={14} className="animate-spin" /> Sedang berpikir...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="ai-chat-input-area" onSubmit={handleSend}>
            <input 
              type="text" 
              placeholder="Tanya ide tugas atau jadwal..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isLoading}
            />
            <button type="submit" className="ai-chat-send" disabled={isLoading || !input.trim()}>
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      {!isOpen && (
        <button className="ai-chat-button" onClick={() => setIsOpen(true)}>
          <MessageSquare size={24} />
        </button>
      )}
    </div>
  );
}
