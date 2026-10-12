import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';

export default function LiveClockWidget() {
  const navigate = useNavigate();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = time.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).replace(/\./g, ':');

  const dateString = time.toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="live-clock-widget">
      <button 
        className="clock-date-btn"
        onClick={() => navigate('/tasks', { state: { tab: 'event' } })}
        title="Buka Agenda Kalender"
      >
        <div className="icon-wrapper blue-icon">
          <CalendarIcon size={18} />
        </div>
        <span>{dateString}</span>
      </button>
      
      <div className="clock-separator"></div>
      
      <div className="clock-time-display">
        <div className="icon-wrapper orange-icon">
          <Clock size={18} />
        </div>
        <span className="time-text">
          {timeString}
        </span>
      </div>
    </div>
  );
}
