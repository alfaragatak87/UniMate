function applyStyles(element, styles) {
  Object.assign(element.style, styles);
  return element;
}

function createTextElement(documentRef, tagName, text, styles = {}) {
  const element = applyStyles(documentRef.createElement(tagName), styles);
  element.textContent = String(text);
  return element;
}

function createTableCell(documentRef, tagName, text, styles = {}) {
  return createTextElement(documentRef, tagName, text, {
    border: '1px solid #ccc',
    padding: tagName === 'th' ? '12px 8px' : '10px 8px',
    ...styles,
  });
}

function getCourseDisplay(course) {
  const courseName = typeof course === 'string' ? course : (course?.name || '');
  let cleanName = courseName;
  let grade = typeof course === 'object' && course?.grade ? course.grade : null;
  const sks = typeof course === 'object' && course?.sks ? course.sks : '-';
  const gradeMatch = String(courseName).match(/(.*?)\s*\(Nilai:\s*([^)]+)\)/i);

  if (gradeMatch) {
    cleanName = gradeMatch[1].trim();
    if (!grade) grade = gradeMatch[2].trim().toUpperCase();
  }

  return Object.freeze({ cleanName, sks, grade: grade || '-' });
}

export function createKHSElement(semester, documentRef = globalThis.document) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('Document KHS tidak tersedia');
  }

  const courses = Array.isArray(semester?.courses) ? semester.courses : [];
  const container = applyStyles(documentRef.createElement('div'), {
    padding: '30px',
    fontFamily: 'Arial, sans-serif',
    color: '#333',
    width: '700px',
    maxWidth: '100%',
    backgroundColor: '#fff',
  });

  const header = applyStyles(documentRef.createElement('div'), {
    textAlign: 'center',
    borderBottom: '2px solid #333',
    paddingBottom: '20px',
    marginBottom: '30px',
  });
  header.appendChild(createTextElement(documentRef, 'h1', 'Kartu Hasil Studi (KHS)', {
    margin: '0',
    fontSize: '24px',
    textTransform: 'uppercase',
  }));
  header.appendChild(createTextElement(documentRef, 'h2', semester?.name || '', {
    margin: '10px 0 0 0',
    fontSize: '18px',
    color: '#555',
  }));
  container.appendChild(header);

  const table = applyStyles(documentRef.createElement('table'), {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '30px',
  });
  const head = documentRef.createElement('thead');
  const headRow = applyStyles(documentRef.createElement('tr'), { backgroundColor: '#f3f4f6' });
  headRow.appendChild(createTableCell(documentRef, 'th', 'No', { textAlign: 'left' }));
  headRow.appendChild(createTableCell(documentRef, 'th', 'Mata Kuliah', { textAlign: 'left' }));
  headRow.appendChild(createTableCell(documentRef, 'th', 'SKS', { textAlign: 'center' }));
  headRow.appendChild(createTableCell(documentRef, 'th', 'Nilai', { textAlign: 'center' }));
  head.appendChild(headRow);
  table.appendChild(head);

  const body = documentRef.createElement('tbody');
  courses.forEach((course, index) => {
    const display = getCourseDisplay(course);
    const row = documentRef.createElement('tr');
    row.appendChild(createTableCell(documentRef, 'td', index + 1));
    row.appendChild(createTableCell(documentRef, 'td', display.cleanName));
    row.appendChild(createTableCell(documentRef, 'td', display.sks, { textAlign: 'center' }));
    row.appendChild(createTableCell(documentRef, 'td', display.grade, {
      textAlign: 'center',
      fontWeight: 'bold',
    }));
    body.appendChild(row);
  });
  table.appendChild(body);
  container.appendChild(table);

  const totalSKS = courses.reduce((total, course) => {
    const parsed = Number.parseInt(typeof course === 'object' && course?.sks ? course.sks : '0', 10);
    return total + (Number.isNaN(parsed) ? 0 : parsed);
  }, 0);
  const summary = applyStyles(documentRef.createElement('div'), {
    display: 'flex',
    justifyContent: 'flex-end',
  });
  const summaryCard = applyStyles(documentRef.createElement('div'), {
    border: '1px solid #ccc',
    padding: '15px 25px',
    borderRadius: '8px',
    backgroundColor: '#f9fafb',
  });
  const totalLine = applyStyles(documentRef.createElement('div'), { marginBottom: '8px' });
  totalLine.appendChild(createTextElement(documentRef, 'strong', 'Total SKS:'));
  totalLine.appendChild(createTextElement(documentRef, 'span', ` ${totalSKS}`));
  summaryCard.appendChild(totalLine);

  const gpaLine = applyStyles(documentRef.createElement('div'), { fontSize: '18px' });
  gpaLine.appendChild(createTextElement(documentRef, 'strong', 'Indeks Prestasi Semester (IPS):'));
  gpaLine.appendChild(createTextElement(documentRef, 'span', ` ${semester?.gpa || '-'}`, { color: '#166534' }));
  summaryCard.appendChild(gpaLine);
  summary.appendChild(summaryCard);
  container.appendChild(summary);

  return container;
}
