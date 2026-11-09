import type { PaperSections } from '../../services/paperIntakeService';

export type ReviewState = 'pending' | 'confirmed' | 'blank' | 'unreadable' | 'ocr_failed' | 'unmarked' | 'unclear';
export type FieldReviews = Record<string, ReviewState>;
export const reviewLabels: Record<ReviewState, string> = {
  pending: 'Choose after checking the scan', confirmed: 'Value confirmed from scan',
  blank: 'Visibly blank on scan', unreadable: 'Handwriting is unreadable',
  ocr_failed: 'OCR failed — correction still needed', unmarked: 'Both boxes visibly unmarked',
  unclear: 'Checkbox mark is unclear',
};
export function representativeIsEmpty(sections: PaperSections) {
  return Object.values(sections.representative_personal_circumstances).every(value => value.trim() === '');
}
export function expandSexAbbreviation(value: string) {
  const abbreviation = value.trim().toLowerCase();
  if (abbreviation === 'm') return 'Male';
  if (abbreviation === 'f') return 'Female';
  return value;
}
export type CheckboxState = 'checked' | 'unchecked' | 'unknown';
export type CheckboxStates = Record<string, CheckboxState>;
export const checkboxPrefix = 'applicant_personal_circumstances.detained.';
export const unknownBoxes = (): CheckboxStates => ({ [checkboxPrefix + 'oo']: 'unknown', [checkboxPrefix + 'hindi']: 'unknown' });
export function detainedSummary(states: CheckboxStates) {
  const oo = states[checkboxPrefix + 'oo'], hindi = states[checkboxPrefix + 'hindi'];
  // A visible mark on one option identifies the single-choice answer. Keep
  // the other box's unknown state intact instead of inferring it unchecked.
  return oo === 'checked' && hindi !== 'checked' ? 'Oo' : hindi === 'checked' && oo !== 'checked' ? 'Hindi' : '';
}
