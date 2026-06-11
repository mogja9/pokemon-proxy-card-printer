import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardDocId,
  rowToDoc,
  INDEX_SETTINGS,
  indexNameForLang,
  localeForLang,
  settingsForLang,
} from '../src/document.js';

test('cardDocId joins uuid and lang with __ (id-safe even for zh-cn)', () => {
  assert.equal(cardDocId('abc-123', 'zh-cn'), 'abc-123__zh-cn');
});

test('rowToDoc coerces pg wire types (string numerics, arrays, bools, nulls)', () => {
  const doc = rowToDoc({
    card_print_id: '11111111-1111-1111-1111-111111111111',
    requested_lang: 'en',
    set_id: 'base1',
    slug: 'base1-4',
    collector_number_raw: '004',
    collector_prefix: '',
    collector_number_num: 4,
    display_name: 'Charizard',
    name_en: 'Charizard',
    name_is_fallback: false,
    name_lang: 'en',
    illustrator: 'Mitsuhiro Arita',
    image_key: 'src/base1/4.png',
    image_remote_url: null,
    image_served_mode: 'stored',
    image_lang: 'en',
    dpi_at_trim: '295.6', // numeric -> string over the pg wire
    is_watermarked: false,
    is_upscaled: false,
    has_localized_image: true,
    supertype: 'Pokemon',
    subtypes: ['Stage 2'],
    types: ['Fire'],
    hp: 120,
    rarity: 'Rare Holo',
    rarity_display: 'Rare Holo',
    regulation_mark: null,
    national_pokedex: [6],
    is_promo: false,
    is_jumbo: false,
    is_error: false,
    is_regional_excl: false,
    is_sealed_only: false,
    release_date: '1999-01-09',
    release_ts: '915840000', // bigint -> string over the pg wire
  });

  assert.equal(doc.id, '11111111-1111-1111-1111-111111111111__en');
  assert.equal(doc.dpiAtTrim, 295.6);
  assert.equal(doc.collectorNumberNum, 4);
  assert.equal(doc.releaseTs, 915840000);
  assert.deepEqual(doc.types, ['Fire']);
  assert.deepEqual(doc.nationalPokedex, [6]);
  assert.equal(doc.isPromo, false);
  assert.equal(doc.imageIsEnglishFallback, false);
});

test('rowToDoc flags EN-fallback images and zeroes null release dates', () => {
  const doc = rowToDoc({
    card_print_id: '22222222-2222-2222-2222-222222222222',
    requested_lang: 'fr',
    set_id: 'base1',
    slug: 'base1-4',
    collector_number_raw: '004',
    collector_prefix: '',
    collector_number_num: 4,
    display_name: 'Dracaufeu',
    name_en: 'Charizard',
    name_is_fallback: false,
    name_lang: 'fr',
    image_lang: 'en', // served EN image while requesting fr
    has_localized_image: false,
    subtypes: [],
    types: [],
    national_pokedex: [],
    release_date: null,
    release_ts: null,
  });
  assert.equal(doc.imageIsEnglishFallback, true);
  assert.equal(doc.releaseTs, 0); // null release -> 0, sorts last under releaseTs:desc
  assert.equal(doc.name, 'Dracaufeu');
  assert.equal(doc.collectorPrefix, '');
});

test('INDEX_SETTINGS: name is the top searchable; lang/setId filterable; releaseTs sortable', () => {
  assert.equal(INDEX_SETTINGS.searchableAttributes?.[0], 'name');
  assert.ok(INDEX_SETTINGS.filterableAttributes?.includes('lang'));
  assert.ok(INDEX_SETTINGS.filterableAttributes?.includes('setId'));
  assert.ok(INDEX_SETTINGS.filterableAttributes?.includes('supertype'));
  assert.ok(INDEX_SETTINGS.sortableAttributes?.includes('releaseTs'));
  // must lift Meili's default 1000-hit cap so the full catalog is reachable
  assert.ok((INDEX_SETTINGS.pagination?.maxTotalHits ?? 0) > 1000);
});

test('indexNameForLang: per-language uid, safe for zh-cn', () => {
  assert.equal(indexNameForLang('en'), 'cards_en');
  assert.equal(indexNameForLang('zh-cn'), 'cards_zh-cn');
});

test('localeForLang: ISO-639-3 incl. CJK; unknown -> eng', () => {
  assert.equal(localeForLang('ja'), 'jpn');
  assert.equal(localeForLang('ko'), 'kor');
  assert.equal(localeForLang('zh-cn'), 'cmn');
  assert.equal(localeForLang('zh-tw'), 'cmn');
  assert.equal(localeForLang('en'), 'eng');
  assert.equal(localeForLang('??'), 'eng');
});

test('settingsForLang: nameEn tokenized as English; name in the index locale', () => {
  const ja = settingsForLang('ja');
  // base settings preserved
  assert.equal(ja.searchableAttributes?.[0], 'name');
  assert.ok((ja.pagination?.maxTotalHits ?? 0) > 1000);
  // nameEn always English so cross-language English queries match the JA card
  const nameEn = ja.localizedAttributes?.find((a) => a.attributePatterns.includes('nameEn'));
  assert.deepEqual(nameEn?.locales, ['eng']);
  // localized name uses this index's CJK locale
  const name = ja.localizedAttributes?.find((a) => a.attributePatterns.includes('name'));
  assert.deepEqual(name?.locales, ['jpn']);
});
