import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naechsterZeitpunkt } from '../../src/services/zeitplan.js';

const Z = ['08:00', '16:00'];
const lokal = (d) => `${d.getDate()}. ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

test('vor 08:00 → heute 08:00', () => assert.equal(lokal(naechsterZeitpunkt(Z, new Date(2026, 10, 26, 7, 59))), '26. 8:00'));
test('zwischen den Zeiten → heute 16:00', () => assert.equal(lokal(naechsterZeitpunkt(Z, new Date(2026, 10, 26, 8, 0))), '26. 16:00'));
test('nach 16:00 → morgen 08:00', () => assert.equal(lokal(naechsterZeitpunkt(Z, new Date(2026, 10, 26, 16, 30))), '27. 8:00'));
test('Monatswechsel', () => assert.equal(lokal(naechsterZeitpunkt(Z, new Date(2026, 10, 30, 17))), '1. 8:00'));
