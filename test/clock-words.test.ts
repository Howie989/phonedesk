import { expect, test } from 'bun:test'
import { dayPart, hourWords, numberWords, timeWords } from '../web/deck/src/clock-words'

test('numberWords', () => {
  expect(numberWords(5)).toBe('năm')
  expect(numberWords(10)).toBe('mười')
  expect(numberWords(11)).toBe('mười một')
  expect(numberWords(15)).toBe('mười lăm')
  expect(numberWords(20)).toBe('hai mươi')
  expect(numberWords(21)).toBe('hai mươi mốt')
  expect(numberWords(24)).toBe('hai mươi tư')
  expect(numberWords(25)).toBe('hai mươi lăm')
  expect(numberWords(35)).toBe('ba mươi lăm')
  expect(numberWords(59)).toBe('năm mươi chín')
})

test('hourWords wraps to 12 hour', () => {
  expect(hourWords(0)).toBe('mười hai')
  expect(hourWords(12)).toBe('mười hai')
  expect(hourWords(13)).toBe('một')
  expect(hourWords(23)).toBe('mười một')
})

test('timeWords: the cases from the brief', () => {
  expect(timeWords(10, 55).text).toBe('mười một giờ kém năm')
  expect(timeWords(10, 30).text).toBe('mười giờ rưỡi')
  expect(timeWords(7, 15).text).toBe('bảy giờ mười lăm')
})

test('timeWords: on the hour, lẻ, kém boundary', () => {
  expect(timeWords(9, 0).text).toBe('chín giờ')
  expect(timeWords(7, 5).text).toBe('bảy giờ lẻ năm')
  expect(timeWords(7, 9).text).toBe('bảy giờ lẻ chín')
  expect(timeWords(7, 10).text).toBe('bảy giờ mười')
  expect(timeWords(7, 39).text).toBe('bảy giờ ba mươi chín')
  expect(timeWords(9, 40).text).toBe('mười giờ kém hai mươi')
  expect(timeWords(9, 45).text).toBe('mười giờ kém mười lăm')
  expect(timeWords(9, 59).text).toBe('mười giờ kém một')
})

test('timeWords: midnight, noon and wrap at 23:xx', () => {
  expect(timeWords(0, 0).text).toBe('mười hai giờ')
  expect(timeWords(0, 30).text).toBe('mười hai giờ rưỡi')
  expect(timeWords(12, 15).text).toBe('mười hai giờ mười lăm')
  expect(timeWords(23, 50).text).toBe('mười hai giờ kém mười')
  expect(timeWords(23, 50).part).toBe('đêm')
})

test('dayPart', () => {
  expect(dayPart(3)).toBe('đêm')
  expect(dayPart(7)).toBe('sáng')
  expect(dayPart(12)).toBe('trưa')
  expect(dayPart(15)).toBe('chiều')
  expect(dayPart(20)).toBe('tối')
})

import { timeWordsEn } from '../web/deck/src/clock-words'
test('timeWordsEn', () => {
  expect(timeWordsEn(10, 0).text).toBe("ten o'clock")
  expect(timeWordsEn(10, 5).text).toBe('five past ten')
  expect(timeWordsEn(10, 15).text).toBe('quarter past ten')
  expect(timeWordsEn(10, 30).text).toBe('half past ten')
  expect(timeWordsEn(10, 40).text).toBe('twenty to eleven')
  expect(timeWordsEn(10, 45).text).toBe('quarter to eleven')
  expect(timeWordsEn(23, 55).text).toBe('five to twelve')
  expect(timeWordsEn(0, 0).part).toBe('night')
  expect(timeWordsEn(14, 20).part).toBe('afternoon')
})
