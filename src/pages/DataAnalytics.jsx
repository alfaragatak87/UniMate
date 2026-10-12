import React, { useState } from 'react';
import Papa from 'papaparse';
import { 
  BarChart, Bar, LineChart, Line, AreaChart, Area, 
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  PieChart, Pie, Cell,
  ScatterChart, Scatter,
  FunnelChart, Funnel, LabelList,
  Treemap,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { Upload, Sparkles, Loader2, FileText, BarChart3 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppContext } from '../context/AppContext';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default function DataAnalytics() {
  const [data, setData] = useState([]);
  const [fileName, setFileName] = useState('');
  const [columns, setColumns] = useState([]);
  const [numericColumns, setNumericColumns] = useState([]);
  const [xAxis, setXAxis] = useState('');
  const [selectedYAxes, setSelectedYAxes] = useState([]);
    const [chartType, setChartType] = useState('bar');
  const [recommendedChart, setRecommendedChart] = useState('');
  const [lineStyle, setLineStyle] = useState('monotone');
  
  const { semesters, apiKey } = useAppContext();
  const [aiInsight, setAiInsight] = useState('');
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    
    // Reset AI Insight when uploading new file
    setAiInsight('');

    const reader = new FileReader();
    reader.onload = (event) => {
      let csvText = event.target.result;
      let lines = csvText.split(/\r?\n/);
      
      let startIndex = 0;
      for (let i = 0; i < Math.min(lines.length, 20); i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('-') && (line.includes(',') || line.includes(';') || line.includes('\t'))) {
          startIndex = i;
          break;
        }
      }
      
      const cleanCsvText = lines.slice(startIndex).join('\n');

      Papa.parse(cleanCsvText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            let cols = Object.keys(results.data[0]).filter(col => col.trim() !== '');
            const validData = results.data.filter(row => cols.some(col => row[col] !== null && row[col] !== ''));
            
            const firstRow = validData[0] || {};
            const numCols = cols.filter(col => typeof firstRow[col] === 'number');
            const catCols = cols.filter(col => typeof firstRow[col] !== 'number');
            
            setColumns(cols);
            setNumericColumns(numCols);
            const finalXAxis = catCols.length > 0 ? catCols[0] : cols[0] || '';
            setXAxis(finalXAxis);
            setSelectedYAxes(numCols.slice(0, 5));
            setData(validData);
            
            // Smart Recommendation Logic
            let rec = 'bar';
            const xColLower = finalXAxis.toLowerCase();
            const isTime = xColLower.match(/(tanggal|waktu|date|time|tahun|bulan|hari|jam|menit|year|month|day)/i);
            
            if (isTime) {
              rec = 'line';
            } else if (numCols.length >= 3) {
              rec = 'radar';
            } else if (validData.length <= 7 && numCols.length === 1) {
              rec = 'pie';
            } else if (validData.length > 20) {
              rec = 'scatter';
            }
            
            setRecommendedChart(rec);
            setChartType(rec); // Auto-select the recommended chart
            
            toast.success('Data dimuat & Grafik direkomendasikan!');
          } else {
            toast.error('File CSV kosong atau tidak valid.');
          }
        },
        error: () => {
          toast.error('Gagal membaca file CSV.');
        }
      });
    };
    reader.onerror = () => toast.error('Gagal membaca file.');
    reader.readAsText(file);
  };

  const generateAIInsight = async () => {
    if (!apiKey) {
      toast.error('API Key Gemini belum diatur! Silakan isi di menu Settings.');
      return;
    }
    if (data.length === 0) return;

    setIsGeneratingInsight(true);
    setAiInsight('');

    // Fallback logic in case API fails
    const fallbackInsight = () => {
      if (selectedYAxes.length === 0) return "Silakan pilih setidaknya satu data untuk dianalisis.";
      
      const insights = selectedYAxes.map(y => {
        const validRows = data.filter(r => typeof r[y] === 'number');
        if (validRows.length === 0) return `- **${y}:** Tidak ada data angka valid.`;
        
        let sum = 0; let min = validRows[0]; let max = validRows[0];
        validRows.forEach(row => {
          sum += row[y];
          if (row[y] < min[y]) min = row;
          if (row[y] > max[y]) max = row;
        });
        const avg = sum / validRows.length;
        const trend = validRows[validRows.length - 1][y] >= validRows[0][y] ? 'kenaikan atau stabil' : 'penurunan';
        
        return `- **${y}:** Rata-rata **${avg.toFixed(2)}**. Tertinggi **${max[y]}** (pada ${xAxis} **${max[xAxis]}**). Terendah **${min[y]}** (pada ${xAxis} **${min[xAxis]}**). Tren **${trend}**.`;
      });

      return `*(Kesimpulan Otomatis Offline)*\n\n${insights.join('\n')}`;
    };

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      // Ambil sampel data (maks 50 baris untuk hemat token)
      const sampleData = data.slice(0, 50);
      const dataString = JSON.stringify(sampleData);
      
      const prompt = `Kamu adalah analis data ahli. 
Berikut adalah sampel data CSV (maks 50 baris) dalam format JSON:
${dataString}

Sumbu X yang dipilih: ${xAxis}
Sumbu Y yang ditampilkan: ${selectedYAxes.join(', ')}

Tolong berikan ringkasan analitis singkat (maksimal 4 poin utama) dalam bahasa Indonesia mengenai tren, korelasi antar variabel, atau anomali dari Sumbu Y yang ditampilkan terhadap Sumbu X (${xAxis}). 
Buat responsmu rapi menggunakan format markdown bullet points. Jangan terlalu panjang.`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      setAiInsight(response.text());
    } catch (error) {
      console.error('Gemini API Error:', error);
      toast.error('API Key tidak valid atau koneksi gagal. Menggunakan analisis offline.');
      setAiInsight(fallbackInsight());
    } finally {
      setIsGeneratingInsight(false);
    }
  };

  const renderMarkdown = (text) => {
    if (!text) return null;
    let html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^[-*]\s+(.*)$/gm, '<li style="margin-left: 1.5rem; margin-bottom: 0.5rem;">$1</li>');
      
    html = html.split('\n').map(line => {
      if (line.trim() === '') return '';
      if (!line.trim().startsWith('<li')) {
        return `<p style="margin-bottom: 0.5rem">${line}</p>`;
      }
      return line;
    }).join('');
    
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  };

  return (
    <div>
      <div className="page-header" style={{ 
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ 
            width: '48px', height: '48px', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%)',
            borderRadius: '12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white',
            boxShadow: '0 8px 16px rgba(99, 102, 241, 0.2)'
          }}>
            <BarChart3 size={24} />
          </div>
          <div>
            <h1 className="page-title" style={{ marginBottom: '0.25rem', lineHeight: 1 }}>Data Analytics</h1>
            <p className="page-subtitle" style={{ margin: 0 }}>Unggah file .csv untuk memvisualisasikan data penelitian atau tugas Anda.</p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <label 
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '2rem 1rem',
            border: '2px dashed var(--border-color)', borderRadius: '12px',
            backgroundColor: 'var(--bg-color)', cursor: 'pointer', transition: 'all 0.2s ease',
            color: 'var(--text-muted)'
          }}
          onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--primary-color)'; }}
          onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        >
          <Upload size={36} style={{ marginBottom: '1rem', color: 'var(--primary-color)' }} />
          <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>Klik untuk Mengunggah Dataset</span>
          <span style={{ fontSize: '0.85rem' }}>Mendukung format .csv (Max 10MB)</span>
          {fileName && (
            <span style={{ marginTop: '1rem', padding: '0.5rem 1rem', backgroundColor: 'var(--card-bg)', borderRadius: '8px', color: 'var(--primary-color)', fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--border-color)' }}>
              <FileText size={14} /> {fileName}
            </span>
          )}
          <input 
            type="file" 
            accept=".csv" 
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {data.length > 0 && (
        <div className="dashboard-grid">
          {/* Controls */}
          <div className="card">
            <h3 style={{ marginBottom: '1rem', color: 'var(--text-main)' }}>Pengaturan Grafik</h3>
            
            <div className="form-group">
              <label>Pilih Sumbu X (Kategori/Waktu)</label>
              <select className="form-input" value={xAxis} onChange={e => setXAxis(e.target.value)}>
                {columns.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </div>
            
            <div className="form-group">
              <label>Data yang Ditampilkan</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                {numericColumns.length > 0 ? numericColumns.map(col => {
                  const isActive = selectedYAxes.includes(col);
                  return (
                    <button 
                      key={col}
                      onClick={() => setSelectedYAxes(prev => isActive ? prev.filter(y => y !== col) : [...prev, col])}
                      className={`btn ${isActive ? 'btn-primary' : 'btn-outline'}`}
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', borderRadius: '20px' }}
                    >
                      {col}
                    </button>
                  );
                }) : <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Tidak ada data angka terdeteksi.</span>}
              </div>
            </div>

            <div className="form-group">
              <label style={{display:'flex', alignItems:'center', gap:'0.5rem'}}>Jenis Diagram (18 Pilihan) {recommendedChart && <span style={{fontSize:'0.75rem', background:'linear-gradient(135deg, #10b981 0%, #059669 100%)', color:'white', padding:'0.2rem 0.6rem', borderRadius:'20px', display:'inline-flex', alignItems:'center', gap:'4px'}}><Sparkles size={12} /> Disarankan AI: {recommendedChart.charAt(0).toUpperCase() + recommendedChart.slice(1)}</span>}</label>
              <select className="form-input" value={chartType} onChange={e => setChartType(e.target.value)}>
                <optgroup label="Grafik Standar (Angka)">
                  <option value="bar">3. Diagram Batang (Bar)</option>
                  <option value="line">2. Grafik Garis (Line)</option>
                  <option value="pie">4. Diagram Lingkaran (Pie)</option>
                  <option value="scatter">16. Petak Sebar (Scatter)</option>
                  <option value="area">Grafik Area</option>
                  <option value="radar">Diagram Jaring (Radar)</option>
                  <option value="funnel">12. Bagan Corong (Funnel)</option>
                  <option value="treemap">6. Diagram Pohon (Treemap)</option>
                </optgroup>
                <optgroup label="Diagram Struktural (Konseptual CSV)">
                  <option value="flowchart">1. Diagram Alir (Flowchart)</option>
                  <option value="venn">5. Diagram Venn</option>
                  <option value="org">7. Bagan Organisasi</option>
                  <option value="gantt">8. Grafik Gantt</option>
                  <option value="uml">9. Diagram UML</option>
                  <option value="swot">10. Analisis SWOT</option>
                  <option value="fishbone">11. Tulang Ikan (Fishbone)</option>
                  <option value="sipoc">13. Diagram SIPOC</option>
                  <option value="swimlane">14. Jalur Renang (Swimlane)</option>
                  <option value="mindmap">15. Peta Pikiran (Mind Map)</option>
                  <option value="pert">17. Bagan PERT</option>
                  <option value="network">18. Diagram Jaringan</option>
                </optgroup>
              </select>
            </div>

            {(chartType === 'line' || chartType === 'area') && (
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label>Gaya Garis</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    className={`btn ${lineStyle === 'monotone' ? 'btn-primary' : 'btn-outline'}`} 
                    onClick={() => setLineStyle('monotone')}
                    style={{ flex: 1, padding: '0.35rem 0', fontSize: '0.85rem' }}
                  >
                    Halus (Smooth)
                  </button>
                  <button 
                    className={`btn ${lineStyle === 'linear' ? 'btn-primary' : 'btn-outline'}`} 
                    onClick={() => setLineStyle('linear')}
                    style={{ flex: 1, padding: '0.35rem 0', fontSize: '0.85rem' }}
                  >
                    Lurus (Linear)
                  </button>
                  <button 
                    className={`btn ${lineStyle === 'step' ? 'btn-primary' : 'btn-outline'}`} 
                    onClick={() => setLineStyle('step')}
                    style={{ flex: 1, padding: '0.35rem 0', fontSize: '0.85rem' }}
                  >
                    Tangga (Step)
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: '2rem' }}>
              <button 
                className="btn btn-primary" 
                style={{ width: '100%', background: 'linear-gradient(135deg, var(--primary-color), #8b5cf6)', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                onClick={generateAIInsight}
                disabled={isGeneratingInsight}
              >
                {isGeneratingInsight ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {isGeneratingInsight ? 'Menganalisis...' : 'Analisis dengan AI'}
              </button>
            </div>
          </div>

          {/* Chart Display */}
          <div className="card" style={{ gridColumn: 'span 2' }}>
            <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-main)', textAlign: 'center' }}>
              Visualisasi Data
            </h3>
            <div style={{ width: '100%', height: 350 }}>
              <ResponsiveContainer width="100%" height="100%">
                {(() => {
                  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
                  if (chartType === 'bar') {
                    return (
                      <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey={xAxis} stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{fill: 'var(--bg-color)'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        <Legend iconType="circle" />
                        {selectedYAxes.map((y, idx) => (
                          <Bar key={y} dataKey={y} fill={colors[idx % colors.length]} radius={[4, 4, 0, 0]} />
                        ))}
                      </BarChart>
                    );
                  }
                  if (chartType === 'area') {
                    return (
                      <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey={xAxis} stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        <Legend iconType="circle" />
                        {selectedYAxes.map((y, idx) => (
                          <Area key={y} type={lineStyle} dataKey={y} stroke={colors[idx % colors.length]} fill={colors[idx % colors.length]} fillOpacity={0.3} strokeWidth={2} />
                        ))}
                      </AreaChart>
                    );
                  }
                  if (chartType === 'radar') {
                    return (
                      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey={xAxis} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <PolarRadiusAxis angle={30} domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} />
                        <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        <Legend iconType="circle" />
                        {selectedYAxes.map((y, idx) => (
                          <Radar key={y} name={y} dataKey={y} stroke={colors[idx % colors.length]} fill={colors[idx % colors.length]} fillOpacity={0.5} />
                        ))}
                      </RadarChart>
                    );
                  }
                  if (chartType === 'pie') {
                    // Pie Chart uses only the first selected Y-axis
                    const yKey = selectedYAxes[0];
                    return (
                      <PieChart>
                        <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        <Legend iconType="circle" />
                        <Pie
                          data={data}
                          dataKey={yKey}
                          nameKey={xAxis}
                          cx="50%"
                          cy="50%"
                          outerRadius={120}
                          fill="#8884d8"
                          label
                        >
                          {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    );
                  }
                  if (chartType === 'scatter') {
                    return (
                      <ScatterChart margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis type="category" dataKey="x" name={xAxis} stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis dataKey="y" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{strokeDasharray: '3 3'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        <Legend iconType="circle" />
                        {selectedYAxes.map((y, idx) => (
                          <Scatter key={y} name={y} data={data.map(d => ({ x: d[xAxis], y: d[y] }))} fill={colors[idx % colors.length]} />
                        ))}
                      </ScatterChart>
                    );
                  }
                  if (chartType === 'funnel') {
                    const yKey = selectedYAxes[0];
                    return (
                      <FunnelChart>
                        <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        <Legend iconType="circle" />
                        <Funnel
                          dataKey={yKey}
                          data={data}
                          isAnimationActive
                        >
                          {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                          ))}
                          <LabelList position="right" fill="#64748b" stroke="none" dataKey={xAxis} />
                        </Funnel>
                      </FunnelChart>
                    );
                  }

                  if (chartType === 'treemap') {
                    const treeData = [{ name: 'Data', children: data.map(d => ({ name: d[xAxis]?.toString() || 'Item', size: d[selectedYAxes[0]] || 1 })) }];
                    return (
                      <Treemap data={treeData} dataKey="size" stroke="#fff" fill="#8b5cf6" aspectRatio={4/3}>
                        <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                      </Treemap>
                    );
                  }
                  
                  const isConceptual = ['flowchart','venn','org','gantt','uml','swot','fishbone','sipoc','swimlane','mindmap','pert','network'].includes(chartType);
                  if (isConceptual) {
                    return (
                      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.5s ease-in-out' }}>
                        <div style={{ 
                          background: 'linear-gradient(135deg, rgba(248, 250, 252, 0.8) 0%, rgba(241, 245, 249, 0.8) 100%)', 
                          backdropFilter: 'blur(10px)',
                          padding: '1rem', 
                          borderRadius: '12px', 
                          marginBottom: '1.5rem', 
                          border: '1px solid rgba(255, 255, 255, 0.5)', 
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                          fontSize: '0.9rem',
                          color: '#334155'
                        }}>
                          <strong style={{color: '#6366f1'}}>✨ Mode Konseptual:</strong> Diagram ini direpresentasikan secara dinamis menggunakan struktur data CSV Anda (<span style={{color:'#3b82f6', fontWeight:'bold'}}>{xAxis}</span>, <span style={{color:'#10b981', fontWeight:'bold'}}>{selectedYAxes.join(', ')}</span>).
                        </div>
                        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: '1rem', background: '#ffffff', borderRadius: '16px', boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.02)' }}>
                           {chartType === 'swot' && (
                             <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem', height:'100%'}}>
                               <div style={{background:'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)', padding:'1.5rem', borderRadius:'16px', boxShadow:'0 10px 15px -3px rgba(14, 165, 233, 0.2)', transition:'transform 0.2s', cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.transform='scale(1.02)'} onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}><h4 style={{color:'#0369a1', marginBottom:'0.5rem', fontSize:'1.2rem', fontWeight:'700'}}>Kekuatan (Strengths)</h4><p style={{color:'#0c4a6e', fontWeight:'500'}}>{columns[0] || 'N/A'}</p></div>
                               <div style={{background:'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)', padding:'1.5rem', borderRadius:'16px', boxShadow:'0 10px 15px -3px rgba(239, 68, 68, 0.2)', transition:'transform 0.2s', cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.transform='scale(1.02)'} onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}><h4 style={{color:'#b91c1c', marginBottom:'0.5rem', fontSize:'1.2rem', fontWeight:'700'}}>Kelemahan (Weaknesses)</h4><p style={{color:'#7f1d1d', fontWeight:'500'}}>{columns[1] || 'N/A'}</p></div>
                               <div style={{background:'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', padding:'1.5rem', borderRadius:'16px', boxShadow:'0 10px 15px -3px rgba(245, 158, 11, 0.2)', transition:'transform 0.2s', cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.transform='scale(1.02)'} onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}><h4 style={{color:'#b45309', marginBottom:'0.5rem', fontSize:'1.2rem', fontWeight:'700'}}>Peluang (Opportunities)</h4><p style={{color:'#78350f', fontWeight:'500'}}>{columns[2] || 'N/A'}</p></div>
                               <div style={{background:'linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)', padding:'1.5rem', borderRadius:'16px', boxShadow:'0 10px 15px -3px rgba(168, 85, 247, 0.2)', transition:'transform 0.2s', cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.transform='scale(1.02)'} onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}><h4 style={{color:'#7e22ce', marginBottom:'0.5rem', fontSize:'1.2rem', fontWeight:'700'}}>Ancaman (Threats)</h4><p style={{color:'#581c87', fontWeight:'500'}}>{columns[3] || 'N/A'}</p></div>
                             </div>
                           )}
                           {chartType === 'venn' && (
                             <div style={{position:'relative', display:'flex', justifyContent:'center', alignItems:'center', height:'100%'}}>
                               <div style={{width:'220px', height:'220px', borderRadius:'50%', background:'linear-gradient(135deg, rgba(59, 130, 246, 0.7) 0%, rgba(37, 99, 235, 0.7) 100%)', mixBlendMode:'multiply', display:'flex', alignItems:'center', justifyContent:'center', transform:'translateX(40px)', boxShadow:'0 10px 25px -5px rgba(59,130,246,0.5)', zIndex:2, color:'white', fontWeight:'700', fontSize:'1.1rem', textShadow:'0 2px 4px rgba(0,0,0,0.3)'}}><span>{selectedYAxes[0]}</span></div>
                               <div style={{width:'220px', height:'220px', borderRadius:'50%', background:'linear-gradient(135deg, rgba(139, 92, 246, 0.7) 0%, rgba(124, 58, 237, 0.7) 100%)', mixBlendMode:'multiply', display:'flex', alignItems:'center', justifyContent:'center', transform:'translateX(-40px)', boxShadow:'0 10px 25px -5px rgba(139,92,246,0.5)', zIndex:1, color:'white', fontWeight:'700', fontSize:'1.1rem', textShadow:'0 2px 4px rgba(0,0,0,0.3)'}}><span>{xAxis}</span></div>
                             </div>
                           )}
                           {chartType === 'org' && (
                             <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'1.5rem', paddingTop:'2rem'}}>
                               <div style={{padding:'0.8rem 2rem', background:'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)', color:'white', borderRadius:'12px', boxShadow:'0 10px 15px -3px rgba(79, 70, 229, 0.4)', fontWeight:'bold', fontSize:'1.2rem', border:'2px solid rgba(255,255,255,0.2)'}}>{xAxis} (Root)</div>
                               <div style={{width:'4px', height:'30px', background:'linear-gradient(to bottom, #4f46e5, #94a3b8)', borderRadius:'2px'}}></div>
                               <div style={{display:'flex', gap:'2rem', position:'relative'}}>
                                 <div style={{position:'absolute', top:'-30px', left:'15%', right:'15%', height:'4px', background:'#94a3b8', borderRadius:'2px'}}></div>
                                 {selectedYAxes.slice(0,4).map(y => (
                                   <div key={y} style={{display:'flex', flexDirection:'column', alignItems:'center'}}>
                                     <div style={{width:'4px', height:'30px', background:'#94a3b8', borderRadius:'2px', marginTop:'-30px', marginBottom:'0.5rem'}}></div>
                                     <div style={{padding:'0.8rem 1.5rem', background:'white', border:'2px solid #e2e8f0', borderRadius:'12px', boxShadow:'0 4px 6px -1px rgba(0, 0, 0, 0.1)', fontWeight:'600', color:'#334155'}}>{y}</div>
                                   </div>
                                 ))}
                               </div>
                             </div>
                           )}
                           {chartType === 'mindmap' && (
                             <div style={{position:'relative', height:'100%', display:'flex', alignItems:'center', justifyContent:'center'}}>
                               <div style={{padding:'1.2rem', background:'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color:'white', borderRadius:'50%', zIndex:2, boxShadow:'0 0 20px rgba(245, 158, 11, 0.5)', fontWeight:'bold', fontSize:'1.2rem', border:'3px solid rgba(255,255,255,0.3)'}}>{xAxis}</div>
                               {selectedYAxes.slice(0,6).map((y, i) => {
                                  const total = Math.min(6, selectedYAxes.length);
                                  const angle = (i / total) * Math.PI * 2;
                                  const r = 140;
                                  const x = Math.cos(angle) * r;
                                  const yPos = Math.sin(angle) * r;
                                  return (
                                    <div key={y}>
                                      <svg style={{position:'absolute', top:0, left:0, width:'100%', height:'100%', zIndex:1, overflow:'visible'}}>
                                        <line x1="50%" y1="50%" x2={`calc(50% + ${x}px)`} y2={`calc(50% + ${yPos}px)`} stroke="#cbd5e1" strokeWidth="3" strokeDasharray="5,5" />
                                      </svg>
                                      <div style={{position:'absolute', transform:`translate(calc(-50% + ${x}px), calc(-50% + ${yPos}px))`, background:'white', color:'#0f172a', padding:'0.6rem 1rem', borderRadius:'20px', zIndex:2, whiteSpace:'nowrap', boxShadow:'0 4px 6px -1px rgba(0, 0, 0, 0.1)', border:'2px solid #3b82f6', fontWeight:'600'}}>{y}</div>
                                    </div>
                                  );
                               })}
                             </div>
                           )}
                           {chartType === 'fishbone' && (
                             <div style={{display:'flex', alignItems:'center', height:'100%', padding:'1rem 2rem'}}>
                               <div style={{flex:1, borderBottom:'6px solid #334155', position:'relative', display:'flex', justifyContent:'space-around'}}>
                                 {selectedYAxes.slice(0,4).map((y,i) => (
                                   <div key={y} style={{position:'absolute', [i%2===0?'bottom':'top']:'0', padding:'0.5rem 1rem', background:'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)', borderRadius:'8px', transform: i%2===0?'translateY(-40px)':'translateY(40px)', border:'1px solid #cbd5e1', boxShadow:'0 4px 6px -1px rgba(0,0,0,0.1)', fontWeight:'600', color:'#0f172a'}}>
                                     {y}
                                     <div style={{position:'absolute', [i%2===0?'bottom':'top']:'-40px', left:'50%', width:'4px', height:'40px', background:'#64748b', transform:'rotate(' + (i%2===0?'30deg':'-30deg') + ')', transformOrigin:i%2===0?'bottom center':'top center'}}></div>
                                   </div>
                                 ))}
                               </div>
                               <div style={{padding:'1.5rem', background:'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color:'white', clipPath:'polygon(20% 0%, 100% 50%, 20% 100%, 0% 100%, 15% 50%, 0% 0%)', width:'120px', height:'100px', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', fontSize:'1.2rem', boxShadow:'-5px 0 15px rgba(239, 68, 68, 0.4)', marginLeft:'-10px'}}>{xAxis.substring(0,8)}...</div>
                             </div>
                           )}
                           {chartType === 'flowchart' && (
                             <div style={{display:'flex', gap:'1rem', alignItems:'center', overflowX:'auto', height:'100%', padding:'1rem'}}>
                               <div style={{padding:'1rem 2rem', borderRadius:'50px', background:'linear-gradient(135deg, #10b981 0%, #059669 100%)', color:'white', fontWeight:'bold', boxShadow:'0 4px 6px rgba(16, 185, 129, 0.3)', border:'2px solid rgba(255,255,255,0.2)'}}>Mulai</div>
                               <span style={{fontSize:'24px', color:'#94a3b8', fontWeight:'bold'}}>➔</span>
                               {selectedYAxes.slice(0,3).map(y => (
                                 <span key={y} style={{display:'flex', alignItems:'center', gap:'1rem'}}>
                                   <div style={{padding:'1rem 1.5rem', background:'white', color:'#0f172a', borderRadius:'8px', border:'2px solid #3b82f6', fontWeight:'600', boxShadow:'0 4px 6px rgba(59, 130, 246, 0.1)'}}>{y}</div>
                                   <span style={{fontSize:'24px', color:'#94a3b8', fontWeight:'bold'}}>➔</span>
                                 </span>
                               ))}
                               <div style={{padding:'1rem 2rem', borderRadius:'50px', background:'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color:'white', fontWeight:'bold', boxShadow:'0 4px 6px rgba(239, 68, 68, 0.3)', border:'2px solid rgba(255,255,255,0.2)'}}>Selesai</div>
                             </div>
                           )}
                           {chartType === 'gantt' && (
                             <div style={{display:'flex', flexDirection:'column', gap:'1.5rem', overflowY:'auto', height:'100%', padding:'2rem 1rem'}}>
                               {selectedYAxes.map((y,i) => (
                                 <div key={y} style={{display:'flex', alignItems:'center', gap:'1rem'}}>
                                   <div style={{width:'120px', fontSize:'0.9rem', textAlign:'right', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontWeight:'600', color:'#475569'}}>{y}</div>
                                   <div style={{flex:1, background:'#f1f5f9', height:'24px', borderRadius:'12px', position:'relative', boxShadow:'inset 0 2px 4px rgba(0,0,0,0.05)'}}>
                                      <div style={{position:'absolute', left:`${(i*10)%50}%`, width:`${20+(i*5)%20}%`, height:'100%', background:'linear-gradient(90deg, #8b5cf6 0%, #a855f7 100%)', borderRadius:'12px', boxShadow:'0 2px 10px rgba(139, 92, 246, 0.4)', backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)', backgroundSize: '1rem 1rem'}}></div>
                                   </div>
                                 </div>
                               ))}
                             </div>
                           )}
                           {chartType === 'uml' && (
                             <div style={{display:'flex', gap:'2rem', justifyContent:'center', height:'100%', alignItems:'center'}}>
                               <div style={{border:'1px solid #cbd5e1', width:'250px', borderRadius:'12px', overflow:'hidden', background:'white', boxShadow:'0 10px 25px -5px rgba(0,0,0,0.1)'}}>
                                  <div style={{background:'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', padding:'1rem', fontWeight:'bold', borderBottom:'2px solid #e2e8f0', textAlign:'center', color:'#0f172a', fontSize:'1.1rem'}}>ModelData</div>
                                  <div style={{padding:'1rem', borderBottom:'1px solid #e2e8f0', fontSize:'0.9rem', color:'#334155', lineHeight:'1.8'}}>
                                    <span style={{color:'#ef4444'}}>+</span> {xAxis}: <span style={{color:'#3b82f6'}}>String</span><br/>
                                    <span style={{color:'#ef4444'}}>+</span> {selectedYAxes[0] || 'Value'}: <span style={{color:'#10b981'}}>Number</span>
                                  </div>
                                  <div style={{padding:'1rem', fontSize:'0.9rem', color:'#334155', lineHeight:'1.8', background:'#f8fafc'}}>
                                    <span style={{color:'#f59e0b'}}>+</span> ambil{xAxis}()<br/>
                                    <span style={{color:'#f59e0b'}}>+</span> hitung()
                                  </div>
                               </div>
                             </div>
                           )}
                           {chartType === 'sipoc' && (
                             <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:'1rem', textAlign:'center', height:'100%', alignItems:'center'}}>
                               {['Pemasok','Masukan','Proses','Keluaran','Pelanggan'].map((t, i) => (
                                 <div key={t} style={{background:'white', color:'#0f172a', padding:'1.5rem 0.5rem', borderRadius:'12px', boxShadow:'0 4px 6px -1px rgba(0,0,0,0.1)', borderTop:'4px solid ' + ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6'][i]}}>
                                    <h4 style={{marginBottom:'0.5rem', fontSize:'1rem', fontWeight:'bold'}}>{t}</h4>
                                    <small style={{color:'#64748b', fontSize:'0.8rem'}}>{columns[i%columns.length]||'-'}</small>
                                 </div>
                               ))}
                             </div>
                           )}
                           {chartType === 'swimlane' && (
                             <div style={{display:'flex', flexDirection:'column', height:'100%', justifyContent:'center'}}>
                               {['Kategori (X)', 'Metrik (Y)'].map((t, i) => (
                                 <div key={t} style={{display:'flex', borderBottom:'2px solid #e2e8f0', minHeight:'100px'}}>
                                    <div style={{width:'100px', borderRight:'2px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', fontWeight:'bold', textAlign:'center', color:'#475569'}}>{t}</div>
                                    <div style={{flex:1, padding:'1.5rem', display:'flex', alignItems:'center', gap:'1rem', background: i===0?'rgba(16, 185, 129, 0.05)':'rgba(59, 130, 246, 0.05)'}}>
                                      <div style={{padding:'0.8rem 1.5rem', background: i===0?'linear-gradient(135deg, #10b981 0%, #059669 100%)':'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color:'white', borderRadius:'8px', boxShadow:'0 4px 6px rgba(0,0,0,0.1)', fontWeight:'600'}}>{i===0 ? xAxis : selectedYAxes[0]}</div>
                                    </div>
                                 </div>
                               ))}
                             </div>
                           )}
                           {chartType === 'pert' && (
                             <div style={{display:'flex', justifyContent:'center', alignItems:'center', gap:'2rem', height:'100%'}}>
                               <div style={{width:'80px', height:'80px', borderRadius:'50%', background:'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', fontSize:'1.2rem', boxShadow:'0 10px 15px -3px rgba(239, 68, 68, 0.4)', border:'3px solid rgba(255,255,255,0.3)'}}>{columns[0]?.substring(0,3)||'T1'}</div>
                               <div style={{borderTop:'3px dashed #94a3b8', width:'60px'}}></div>
                               <div style={{width:'80px', height:'80px', borderRadius:'50%', background:'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', fontSize:'1.2rem', boxShadow:'0 10px 15px -3px rgba(245, 158, 11, 0.4)', border:'3px solid rgba(255,255,255,0.3)'}}>{columns[1]?.substring(0,3)||'T2'}</div>
                               <div style={{borderTop:'3px dashed #94a3b8', width:'60px'}}></div>
                               <div style={{width:'80px', height:'80px', borderRadius:'50%', background:'linear-gradient(135deg, #10b981 0%, #059669 100%)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', fontSize:'1.2rem', boxShadow:'0 10px 15px -3px rgba(16, 185, 129, 0.4)', border:'3px solid rgba(255,255,255,0.3)'}}>{columns[2]?.substring(0,3)||'T3'}</div>
                             </div>
                           )}
                           {chartType === 'network' && (
                             <div style={{position:'relative', height:'100%', display:'flex', alignItems:'center', justifyContent:'center'}}>
                               <div style={{padding:'1.2rem', background:'linear-gradient(135deg, #334155 0%, #0f172a 100%)', color:'white', borderRadius:'50%', zIndex:2, boxShadow:'0 0 20px rgba(15, 23, 42, 0.5)', fontWeight:'bold', border:'2px solid rgba(255,255,255,0.2)'}}>Pusat</div>
                               {selectedYAxes.slice(0,6).map((y, i) => {
                                  const total = Math.min(6, selectedYAxes.length);
                                  const angle = (i / total) * Math.PI * 2;
                                  const r = 120;
                                  const x = Math.cos(angle) * r;
                                  const yPos = Math.sin(angle) * r;
                                  return (
                                    <div key={y}>
                                      <svg style={{position:'absolute', top:0, left:0, width:'100%', height:'100%', zIndex:1, overflow:'visible'}}>
                                        <line x1="50%" y1="50%" x2={`calc(50% + ${x}px)`} y2={`calc(50% + ${yPos}px)`} stroke="#94a3b8" strokeWidth="3" />
                                      </svg>
                                      <div style={{position:'absolute', transform:`translate(calc(-50% + ${x}px), calc(-50% + ${yPos}px))`, background:'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color:'white', padding:'0.8rem', borderRadius:'50%', zIndex:2, boxShadow:'0 4px 6px rgba(59, 130, 246, 0.4)', border:'2px solid rgba(255,255,255,0.2)', fontWeight:'bold'}}>{y.substring(0,3)}</div>
                                    </div>
                                  )
                               })}
                             </div>
                           )}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey={xAxis} stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                      <Legend iconType="circle" />
                      {selectedYAxes.map((y, idx) => (
                        <Line key={y} type={lineStyle} dataKey={y} stroke={colors[idx % colors.length]} strokeWidth={3} dot={{r: 4, fill: colors[idx % colors.length], strokeWidth: 0}} activeDot={{r: 6}} />
                      ))}
                    </LineChart>
                  );
                })()}
              </ResponsiveContainer>
            </div>
            
            {/* AI Insight Result */}
            {aiInsight && (
              <div style={{ marginTop: '1.5rem', padding: '1.5rem', backgroundColor: 'var(--bg-color)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid #8b5cf6' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', color: '#8b5cf6' }}>
                  <Sparkles size={18} /> Kesimpulan AI UniMate
                </h4>
                <div style={{ lineHeight: '1.6', fontSize: '0.95rem', color: 'var(--text-main)' }}>
                  {renderMarkdown(aiInsight)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
