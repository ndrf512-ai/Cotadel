// Исходные данные кампании «Цитадель».

export const MIN_PER_DAY = 1440;
export const START_T = 16 * 60;              // День 1, 16:00
export const RELIEF_T = 2 * 1440 + 16 * 60;  // День 3, 16:00 (может сдвинуться)

export const SECTORS = {
  N: { id: 'N', name: 'Северный', loc: 'высота «Берёзы»', gen: 'северного', fort: 55, adj: ['E', 'W'] },
  E: { id: 'E', name: 'Восточный', loc: 'старое кладбище', gen: 'восточного', fort: 45, adj: ['N', 'S'] },
  S: { id: 'S', name: 'Южный', loc: 'дорога и овраг', gen: 'южного', fort: 40, adj: ['E', 'W'] },
  W: { id: 'W', name: 'Западный', loc: 'болото «Камыши»', gen: 'западного', fort: 30, adj: ['N', 'S'] },
};
export const SECTOR_IDS = ['N', 'E', 'S', 'W'];

export const RES_LOCS = {
  hq: { name: 'у штаба', short: 'у штаба', t: { N: 25, E: 25, S: 25, W: 20 } },
  center: { name: 'в центре обороны', short: 'центр', t: { N: 15, E: 15, S: 15, W: 18 } },
  nearN: { name: 'у северного сектора', short: 'у севера', t: { N: 5, E: 20, S: 35, W: 22 } },
  nearE: { name: 'у восточного сектора', short: 'у востока', t: { N: 20, E: 5, S: 20, W: 35 } },
  nearS: { name: 'у южного сектора', short: 'у юга', t: { N: 35, E: 20, S: 5, W: 22 } },
};

// Архетипы определяют, КАК характеристики превращаются в поведение.
export const ARCH = {
  executor:  { estimateMul: 1.0, withdrawAt: 9, askReserveAt: 1.6, reportEvery: 120, refuses: 0,   raids: 0,   fortSelf: 0.2 },
  initiator: { estimateMul: 0.8, withdrawAt: 0.92, askReserveAt: 1.45, reportEvery: 0, refuses: 0.2, raids: 1, fortSelf: 0.3 },
  cautious:  { estimateMul: 1.7, withdrawAt: 0.45, askReserveAt: 0.85, reportEvery: 90, refuses: 0.8, raids: 0, fortSelf: 0.6 },
  natural:   { estimateMul: 0.95, withdrawAt: 0.75, askReserveAt: 1.3, reportEvery: 240, refuses: 0.5, raids: 0.5, fortSelf: 1 },
  veteran:   { estimateMul: 1.0, withdrawAt: 0.7, askReserveAt: 1.2, reportEvery: 180, refuses: 0.4, raids: 0.3, fortSelf: 0.5 },
  timid:     { estimateMul: 1.4, withdrawAt: 0.5, askReserveAt: 1.0, reportEvery: 60, refuses: 0.6, raids: 0, fortSelf: 0.2 },
};

export const OFFICERS = [
  {
    id: 'koval', name: 'Лейтенант Аркадий Коваль', short: 'Коваль', arch: 'executor', unit: 'p1',
    exp: 55, disc: 95, init: 15, caution: 50, aggr: 40, auth: 60, resil: 70, care: 45, trust: 55, autonomy: 20,
    look: { beard: false, pale: true, cap: true },
    bio: 'Кадровый. Выпуск 1938 года. Исполнителен, педантичен. Доклады — по форме и минута в минуту.',
  },
  {
    id: 'yartsev', name: 'Старший лейтенант Глеб Ярцев', short: 'Ярцев', arch: 'initiator', unit: 'p2',
    exp: 75, disc: 45, init: 95, caution: 25, aggr: 85, auth: 70, resil: 75, care: 40, trust: 50, autonomy: 55,
    look: { beard: false, pale: false, cap: false },
    bio: 'Дважды ранен, дважды возвращался. Любит действовать, докладывает потом. Соседей не всегда учитывает.',
  },
  {
    id: 'somov', name: 'Лейтенант Пётр Сомов', short: 'Сомов', arch: 'cautious', unit: 'p3',
    exp: 50, disc: 70, init: 35, caution: 95, aggr: 20, auth: 65, resil: 35, care: 95, trust: 50, autonomy: 35,
    look: { beard: false, pale: true, cap: true },
    bio: 'Бывший учитель. Бережёт людей, во взводе его любят. Склонен преувеличивать опасность.',
  },
  {
    id: 'bayramov', name: 'Лейтенант Тимур Байрамов', short: 'Байрамов', arch: 'natural', unit: 'p4',
    exp: 80, disc: 55, init: 75, caution: 45, aggr: 65, auth: 95, resil: 80, care: 70, trust: 45, autonomy: 65,
    look: { beard: true, pale: false, cap: false },
    bio: 'Самородок. Бойцы пойдут за ним куда угодно. Не любит, когда штаб вмешивается в его дела.',
  },
  {
    id: 'kravets', name: 'Сержант Иван Кравец', short: 'Кравец', arch: 'veteran', unit: 'pw',
    exp: 85, disc: 70, init: 60, caution: 60, aggr: 40, auth: 60, resil: 85, care: 60, trust: 55, autonomy: 60,
    look: { beard: true, pale: false, cap: true },
    bio: 'Разведчик, третья война. Говорит мало, ошибается редко. Держит заставу на болоте.',
  },
];

export const STAFF = {
  luchko: { name: 'Мл. лейтенант Вера Лучко', short: 'Лучко', role: 'инженеры' },
  grin: { name: 'Военврач Леонид Гриневич', short: 'Гриневич', role: 'медпункт' },
  dyakov: { name: 'Старшина Дьяков', short: 'Дьяков', role: 'склад' },
  mironova: { name: 'Сержант Оля Мирон', short: 'Мирон', role: 'связь' },
  adj: { name: 'Ординарец Лёшка Гусев', short: 'Гусев', role: 'ординарец' },
};

export const PLATOONS = [
  { id: 'p1', name: '1-й взвод', call: 'Первый', officer: 'koval', men: 29, sector: 'N', ammo: 5, fatigue: 25, morale: 68 },
  { id: 'p2', name: '2-й взвод', call: 'Второй', officer: 'yartsev', men: 27, sector: 'E', ammo: 4.5, fatigue: 30, morale: 72 },
  { id: 'p3', name: '3-й взвод', call: 'Третий', officer: 'somov', men: 30, sector: 'S', ammo: 5, fatigue: 22, morale: 66 },
  { id: 'p4', name: '4-й взвод', call: 'Четвёртый', officer: 'bayramov', men: 28, sector: null, loc: 'center', ammo: 5, fatigue: 10, morale: 75 },
  { id: 'pw', name: 'Застава «Запад»', call: 'Камыши', officer: 'kravets', men: 9, sector: 'W', ammo: 2, fatigue: 20, morale: 70, small: true },
];

export const SERGEANT_NAMES = ['Старший сержант Пётр Глушко', 'Сержант Николай Ведерников', 'Старшина Фёдор Рябой', 'Сержант Алексей Мухин', 'Старший сержант Семён Лаптев', 'Сержант Григорий Зуев'];

export function fmtTime(t) {
  const d = Math.floor(t / 1440) + 1;
  const m = Math.floor(t % 1440);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return { d, hm: `${hh}:${mm}`, full: `День ${d}, ${hh}:${mm}` };
}

export function hourOf(t) { return (t % 1440) / 60; }

/** 0 — день, 1 — ночь, переходы на рассвете и в сумерках. */
export function nightness(t) {
  const h = hourOf(t);
  if (h >= 7 && h < 18) return 0;
  if (h >= 20 || h < 5) return 1;
  if (h >= 18) return (h - 18) / 2;
  return 1 - (h - 5) / 2;
}
