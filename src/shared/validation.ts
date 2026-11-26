import { AppError } from './errors.js';

const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'grapheme' });
export function visibleLength(value: string) { return [...segmenter.segment(value)].length; }
export function normalizeNickname(value: unknown): string {
  if (typeof value !== 'string' || /[\r\n\u0085\u2028\u2029]/u.test(value)) throw new AppError('INVALID_NICKNAME');
  const text=value.trim(),length=visibleLength(text);
  if(length<1||length>20)throw new AppError('INVALID_NICKNAME');return text;
}
export function normalizeAnswer(value: unknown): string {
  if(typeof value!=='string')throw new AppError('INVALID_ANSWER');
  const text=value.trim(),length=visibleLength(text);
  if(length<1||length>200)throw new AppError('INVALID_ANSWER');return text;
}
const names=['Amber','Blake','Cameron','Drew','Eden','Finley','Harper','Jamie','Jordan','Morgan','Parker','Quinn','Riley','Robin','Rowan','Sage','Skyler','Taylor'];
export function randomEnglishNickname() {
  const value=new Uint32Array(1);globalThis.crypto.getRandomValues(value);return names[value[0]!%names.length]!;
}
