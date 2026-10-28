const COURSE_FIELDS = Object.freeze([
  'sks',
  'grade',
  'day',
  'timeStart',
  'timeEnd',
  'room',
  'lecturer',
  'mode',
  'kehadiranUjian',
]);

export class AIScannerMergeError extends Error {
  constructor(code) {
    super('Hasil scan tidak dapat digabungkan.');
    this.name = 'AIScannerMergeError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('id-ID') : '';
}

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

function normalizeIncomingCourse(course, index, idFactory) {
  const source = typeof course === 'string' ? { name: course } : course;
  if (!isPlainObject(source) || !normalizeName(source.name)) throw new AIScannerMergeError('invalid_course');
  const normalized = {
    id: idFactory(index),
    name: source.name.trim(),
    sks: source.sks ?? null,
    grade: source.grade ?? null,
    day: source.day ?? null,
    timeStart: source.timeStart ?? null,
    timeEnd: source.timeEnd ?? null,
    room: source.room ?? null,
    lecturer: source.lecturer ?? null,
    mode: source.mode ?? null,
    kehadiranUjian: source.kehadiranUjian ?? source.kehadiran_ujian ?? null,
  };
  return normalized;
}

function normalizeExistingCourse(course, index, idFactory) {
  if (typeof course === 'string') return { id: idFactory(index), name: course };
  if (!isPlainObject(course) || !normalizeName(course.name)) return null;
  return { ...course };
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createCourseMergePlan(existingCourses, incomingCourses, options = {}) {
  if (!Array.isArray(existingCourses) || !Array.isArray(incomingCourses)) {
    throw new AIScannerMergeError('invalid_courses');
  }
  const idFactory = options.idFactory ?? (index => `scan-course-${index + 1}`);
  if (typeof idFactory !== 'function') throw new AIScannerMergeError('invalid_id_factory');

  const existing = existingCourses.map((course, index) => normalizeExistingCourse(course, index, idFactory));
  const normalizedIncoming = incomingCourses.map((course, index) => normalizeIncomingCourse(course, index, idFactory));
  const incomingNameCounts = new Map();
  for (const course of normalizedIncoming) {
    const key = normalizeName(course.name);
    incomingNameCounts.set(key, (incomingNameCounts.get(key) ?? 0) + 1);
  }

  const mergedCourses = existingCourses.map(course => clone(course));
  const operations = [];

  for (const incoming of normalizedIncoming) {
    const nameKey = normalizeName(incoming.name);
    const existingIndexes = existing
      .map((course, index) => course && normalizeName(course.name) === nameKey ? index : -1)
      .filter(index => index >= 0);

    if (incomingNameCounts.get(nameKey) > 1 || existingIndexes.length > 1) {
      operations.push({ type: 'conflict', name: incoming.name, fields: [] });
      continue;
    }

    if (existingIndexes.length === 0) {
      mergedCourses.push(incoming);
      operations.push({ type: 'add', name: incoming.name, fields: COURSE_FIELDS.filter(field => !isEmpty(incoming[field])) });
      continue;
    }

    const existingIndex = existingIndexes[0];
    const current = existing[existingIndex];
    const updates = [];
    const replacements = [];
    const merged = { ...current };
    for (const field of COURSE_FIELDS) {
      const incomingValue = incoming[field];
      if (isEmpty(incomingValue)) continue;
      const currentValue = current[field];
      if (isEmpty(currentValue)) {
        updates.push(field);
        merged[field] = incomingValue;
      } else if (currentValue !== incomingValue) {
        replacements.push(field);
        merged[field] = incomingValue;
      }
    }

    mergedCourses[existingIndex] = merged;
    operations.push({
      type: replacements.length > 0 ? 'replace' : updates.length > 0 ? 'update' : 'unchanged',
      name: current.name,
      fields: [...updates, ...replacements],
      updates,
      replacements,
    });
  }

  const summary = {
    additions: operations.filter(operation => operation.type === 'add').length,
    updates: operations.filter(operation => operation.type === 'update').length,
    replacements: operations.filter(operation => operation.type === 'replace').length,
    unchanged: operations.filter(operation => operation.type === 'unchanged').length,
    conflicts: operations.filter(operation => operation.type === 'conflict').length,
  };

  return deepFreeze({
    kind: 'unimate-course-merge-plan',
    existingCount: existingCourses.length,
    resultingCount: mergedCourses.length,
    requiresReplacementConfirmation: summary.replacements > 0,
    summary,
    operations,
    mergedCourses,
  });
}

export function applyCourseMergePlan(plan, options = {}) {
  if (!isPlainObject(plan) || plan.kind !== 'unimate-course-merge-plan' || !Array.isArray(plan.mergedCourses)) {
    throw new AIScannerMergeError('invalid_plan');
  }
  if (plan.requiresReplacementConfirmation && options.allowReplacements !== true) {
    throw new AIScannerMergeError('confirmation_required');
  }
  return clone(plan.mergedCourses);
}
