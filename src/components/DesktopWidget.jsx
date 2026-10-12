import { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { CheckSquare } from 'lucide-react';

export default function DesktopWidget() {
  const [time, setTime] = useState(new Date());
  const { tasks } = useAppContext();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours().toString().padStart(2, '0');
  const minutes = time.getMinutes().toString().padStart(2, '0');
  const timeString = `${hours}:${minutes}`;

  const dateString = time.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'short'
  });

  // Get upcoming 3 pending tasks sorted by date
  const upcomingTasks = tasks
    .filter(t => !t.done && t.type === 'task')
    .sort((a, b) => {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    })
    .slice(0, 3);

  return (
    <div className="glass-widget">
      <div className="widget-header">
        <span className="glass-date">{dateString}</span>
        {/* Invisible drag region handled by CSS */}
      </div>
      
      <div className="glass-time-container">
        <h1 className="glass-time">{timeString}</h1>
      </div>

      <div className="glass-tasks">
        <div className="glass-tasks-header">
          <CheckSquare size={14} /> Tugas Terdekat
        </div>
        
        {upcomingTasks.length === 0 ? (
          <p className="glass-empty">Santai, tidak ada tugas mendesak.</p>
        ) : (
          <div className="glass-task-list">
            {upcomingTasks.map(task => (
              <div key={task.id} className="glass-task-item">
                <span className="glass-task-title">{task.title}</span>
                {task.deadline && (
                  <span className="glass-task-date">
                    {new Date(task.deadline).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
