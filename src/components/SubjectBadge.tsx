import type { Subject, SubjectCategory } from '../types';

export const CATEGORY_SHORT: Record<SubjectCategory, string> = {
  CHI: 'CHI',
  ENG: 'ENG',
  MATH: 'MTH',
  CSD: 'CSD',
  ELECTIVE: 'ELE',
};

export function subjectShort(subject: Subject | undefined): string {
  if (!subject) return '—';
  if (subject.category !== 'ELECTIVE') return CATEGORY_SHORT[subject.category];
  if (!subject.custom || subject.name === '選修科') return CATEGORY_SHORT.ELECTIVE;
  return subject.name.slice(0, 2).toUpperCase();
}

export function SubjectBadge({ subject, label }: { subject?: Subject; label?: string }) {
  return <span className="subject-badge" title={subject?.name || label}>{label || subjectShort(subject)}</span>;
}
