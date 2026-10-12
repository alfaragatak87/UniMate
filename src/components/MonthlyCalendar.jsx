import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function MonthlyCalendar({ events = [], onEventClick }) {
  const [currentDate, setCurrentDate] = useState(new Date());

  // Helpers
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sunday

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  };

  const isToday = (day) => {
    const today = new Date();
    return day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
  };

  // Group events by date
  const eventsByDate = useMemo(() => {
    const map = {};
    events.forEach(evt => {
      if (!evt.deadline) return;
      const d = new Date(evt.deadline);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const dateKey = d.getDate();
        if (!map[dateKey]) map[dateKey] = [];
        map[dateKey].push(evt);
      }
    });
    return map;
  }, [events, currentMonth, currentYear]);

  // Generate calendar grid
  const renderGrid = () => {
    const grid = [];
    const weekDays = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    
    // Header
    grid.push(
      <div key="header" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px' }}>
        {weekDays.map(day => (
          <div key={day} style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {day}
          </div>
        ))}
      </div>
    );

    // Days
    const days = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} style={{ padding: '0.5rem', backgroundColor: 'transparent' }} />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayEvents = eventsByDate[day] || [];
      const todayStyle = isToday(day) ? {
        backgroundColor: 'var(--primary-color)',
        color: 'white',
        borderRadius: '50%',
        width: '28px', height: '28px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto'
      } : { textAlign: 'center', padding: '4px' };

      days.push(
        <div key={day} style={{ 
          minHeight: '80px', border: '1px solid var(--border-color)', borderRadius: '8px', 
          padding: '4px', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-color)'
        }}>
          <div style={{ marginBottom: '4px' }}>
            <div style={todayStyle}>{day}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
            {dayEvents.map(evt => (
              <div key={evt.id} 
                onClick={() => onEventClick && onEventClick(evt)}
                style={{ 
                  fontSize: '0.65rem', backgroundColor: '#fef3c7', color: '#d97706', 
                  padding: '2px 4px', borderRadius: '4px', whiteSpace: 'nowrap', 
                  overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer',
                  border: '1px solid #fde68a'
                }}
                title={evt.title}
              >
                {evt.title}
              </div>
            ))}
          </div>
        </div>
      );
    }

    grid.push(
      <div key="days" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {days}
      </div>
    );

    return grid;
  };

  return (
    <div style={{ backgroundColor: 'var(--bg-color)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.2rem' }}>
          {monthNames[currentMonth]} {currentYear}
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-icon" onClick={handlePrevMonth} style={{ border: '1px solid var(--border-color)' }}>
            <ChevronLeft size={18} />
          </button>
          <button className="btn-icon" onClick={handleNextMonth} style={{ border: '1px solid var(--border-color)' }}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      {renderGrid()}
    </div>
  );
}
