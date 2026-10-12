const fs = require('fs');
const file = 'D:\\CODING\\PERSONAL\\APK\\UniMate\\src\\index.css';
const buf = fs.readFileSync(file);
// find the last valid ASCII line: '.ai-chat-send:disabled'
const searchStr = '.ai-chat-send:disabled';
const idx = buf.indexOf(searchStr);
if (idx !== -1) {
  // Find the end of this line
  let endIdx = idx;
  while(endIdx < buf.length && buf[endIdx] !== 10) endIdx++;
  
  // Truncate
  const cleanBuf = buf.slice(0, endIdx + 1);
  
  // Create correct CSS string
  const mobileCSS = `
/* --- MOBILE RESPONSIVENESS --- */
@media (max-width: 768px) {
  .app-layout {
    flex-direction: column;
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }
  
  .sidebar {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    height: auto;
    padding: 0;
    flex-direction: row;
    border-right: none;
    border-top: 1px solid var(--border-color);
    box-shadow: 0 -4px 12px rgba(0,0,0,0.05);
    z-index: 100;
    background-color: var(--card-bg);
  }
  
  .sidebar-logo {
    display: none !important;
  }
  
  .nav-links {
    flex-direction: row;
    padding: 0 0.5rem;
    margin: 0;
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    align-items: center;
    gap: 0.25rem;
  }
  
  .nav-links::-webkit-scrollbar {
    display: none;
  }
  
  .nav-item {
    flex-direction: column;
    padding: 0.5rem 0.75rem;
    font-size: 0.7rem;
    gap: 0.25rem;
    white-space: nowrap;
    border-radius: 8px;
  }
  
  .nav-item.active::before {
    display: none;
  }
  
  .nav-item.active {
    background-color: transparent;
    color: var(--primary-color);
    box-shadow: none;
  }
  
  .nav-links > div,
  .nav-item:last-child {
    display: none !important;
  }
  
  .main-content {
    padding: 1rem;
    padding-bottom: 90px;
    height: auto;
    overflow: visible;
  }
  
  .page-title {
    font-size: 1.5rem;
  }
  
  .dashboard-grid, .settings-grid {
    grid-template-columns: 1fr !important;
  }
  
  .kanban-board {
    flex-direction: column;
    height: auto;
    overflow-y: visible;
  }
  
  .kanban-column {
    flex: none;
    width: 100%;
    min-height: 250px;
  }
  
  .modal-content {
    width: 95%;
    margin: 1rem;
  }
}
`;

  fs.writeFileSync(file, Buffer.concat([cleanBuf, Buffer.from(mobileCSS, 'utf8')]));
  console.log('Fixed CSS file');
} else {
  console.log('Could not find anchor');
}
