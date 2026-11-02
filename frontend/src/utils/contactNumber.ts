export const CONTACT_NUMBER_MAX_DIGITS = 11;

export function sanitizeContactNumberInput(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, CONTACT_NUMBER_MAX_DIGITS);
}

export function isContactNumberPasteAllowed(
  input: HTMLInputElement,
  pastedValue: string,
) {
  if (!/^[0-9]*$/.test(pastedValue)) return false;

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const resultingLength = input.value.length - (end - start) + pastedValue.length;
  return resultingLength <= CONTACT_NUMBER_MAX_DIGITS;
}
