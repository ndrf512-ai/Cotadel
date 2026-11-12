// Речь командиров: характер проявляется в формулировках, а не в цифрах.
import { SECTORS } from './data.js';

export const pick = (a) => a[(Math.random() * a.length) | 0];
/** Число с десятичной запятой. */
export const n1 = (v) => (+v || 0).toFixed(1).replace('.', ',');

export function strengthWords(n) {
  if (n < 25) return 'до отделения';
  if (n < 50) return 'до взвода';
  if (n < 100) return 'до двух взводов';
  if (n < 170) return 'до роты';
  if (n < 260) return 'больше роты';
  return 'до батальона';
}

export function ammoWords(a = 0, arch) {
  if (arch === 'executor') return `боекомплект — ${n1(a)}`;
  if (a <= 0.05) return 'патронов нет совсем';
  if (a < 1) return 'патроны на исходе';
  if (a < 2.2) return 'патронов на один бой';
  if (a < 3.8) return 'патронов на пару хороших боёв';
  return 'с патронами пока нормально';
}

export function fatigueWords(f) {
  if (f < 30) return 'люди в порядке';
  if (f < 55) return 'люди устали';
  if (f < 75) return 'люди вымотаны, третьи сутки без сна';
  return 'люди на пределе — засыпают у пулемётов';
}

export function moraleWords(m) {
  if (m > 72) return 'настроение боевое';
  if (m > 52) return 'держатся';
  if (m > 32) return 'люди подавлены';
  return 'люди на грани, могут не выдержать';
}

const sec = (s) => SECTORS[s];

/** Формирует реплику по ключу с учётом архетипа офицера. */
export function say(o, key, p = {}) {
  const A = o.arch;
  const S = p.sector ? sec(p.sector) : null;
  const T = {
    contact: {
      executor: [`Капитан, докладывает ${o.short}. ${p.time} противник перешёл в атаку на участке ${S?.gen} сектора. Силы — ${strengthWords(p.est)}. Веду бой.`],
      initiator: [`Капитан, у меня гости. ${cap(strengthWords(p.est))}, лезут на ${S?.loc}. Справимся.`, `Ярцев. Пошли на нас, ${strengthWords(p.est)}. Встречаем.`],
      cautious: [`Капитан! Противник атакует, крупными силами — ${strengthWords(p.est)}, не меньше! Прошу быть готовым прислать резерв!`, `Капитан, это Сомов… они идут. Много. ${cap(strengthWords(p.est))}, может больше. Нам будет тяжело.`],
      natural: [`Байрамов. Атакуют, ${strengthWords(p.est)}. Разбираемся.`],
      veteran: [`Кравец. Полезли через камыши. ${cap(strengthWords(p.est))}. Держу.`],
      timid: [`Капитан… атака. ${cap(strengthWords(p.est))}. Что делать?`],
    },
    lineLost: {
      executor: [`Докладываю: первая линия оставлена. Взвод закрепился на второй. Потери уточняю.`],
      initiator: [`Выдавили нас из первой траншеи, капитан. Ненадолго.`],
      cautious: [`Капитан, мы на второй линии. Пришлось отойти — иначе положил бы всех. Нужна помощь!`],
      natural: [`Отошёл на вторую линию — первую они перепахали артиллерией. Держусь.`],
      veteran: [`Отошли на вторую. Камыши у них.`],
      timid: [`Нас выбили… мы на второй линии. Не знаю, сколько продержимся.`],
    },
    lost: {
      executor: [`Капитан… сектор потерян. Остатки взвода отходят к центру. Виноват.`],
      initiator: [`Капитан, нас сбили. Отходим к центру. Дайте людей — верну всё к утру.`],
      cautious: [`Мы не удержали. Простите. Отходим к центру, выносим раненых.`],
      natural: [`Сектор оставил. Людей вывел. Противник у меня в тылу — смотрите за штабом.`],
      veteran: [`Застава снята. Отходим. Болото у них, капитан.`],
      timid: [`Всё… нас смяли. Отходим кто как может.`],
    },
    repelled: {
      executor: [`Атака отбита. Убитых — ${p.k}, раненых — ${p.w}. ${cap(ammoWords(p.ammo, A))}.`],
      initiator: [`Отбились! Мои потери — ${p.k + p.w}. Они там своих положили втрое. ${cap(ammoWords(p.ammo, A))}.`],
      cautious: [`Отбили… Но у меня ${p.k} убитых и ${p.w} раненых. ${cap(ammoWords(p.ammo, A))}. Следующую атаку можем не выдержать.`],
      natural: [`Отбились. ${p.k + p.w} выбыли. ${cap(ammoWords(p.ammo, A))}.`],
      veteran: [`Ушли. У меня ${p.k + p.w} выбыли.`],
      timid: [`Отошли они… у меня потери. ${p.k} убитых.`],
    },
    askReserve: {
      executor: [`Капитан, давление нарастает. Своими силами позицию удержу недолго. Прошу резерв.`],
      initiator: [`Капитан, подкиньте людей — и я их не только удержу, я их отброшу.`],
      cautious: [`Капитан, прошу срочно резерв! Ещё немного — и нас сомнут! Прошу!`, `Мне нужен резерв, капитан. Сейчас. Иначе я отвожу людей.`],
      natural: [`Капитан, тут серьёзно. Нужен резерв, иначе отойду на вторую.`],
      veteran: [`Без помощи не удержу. Решайте.`],
      timid: [`Капитан, пришлите хоть кого-нибудь…`],
    },
    askAmmo: {
      executor: [`Прошу пополнить боеприпасы. ${cap(ammoWords(p.ammo, A))}.`],
      initiator: [`Патроны нужны, капитан. ${cap(ammoWords(p.ammo, 'x'))}. Трофеи кончились.`],
      cautious: [`Капитан, у меня ${ammoWords(p.ammo, 'x')}. Если сейчас полезут — стрелять будет нечем. Пришлите, прошу.`],
      natural: [`Патроны на исходе. Пришлите, сколько сможете.`],
      veteran: [`Патронов мало. Нужно.`],
      timid: [`Патроны… их почти нет.`],
    },
    askRelief: {
      executor: [`Капитан, разрешите доложить: взвод на позиции ${p.hours} часов. ${cap(fatigueWords(p.fatigue))}. Прошу рассмотреть смену.`],
      initiator: [`Мои держатся, но ${fatigueWords(p.fatigue)}. Сменишь нас, капитан? Хоть на шесть часов.`],
      cautious: [`Капитан, люди не спят. ${cap(fatigueWords(p.fatigue))}. Мне нужна смена, иначе я за них не ручаюсь.`],
      natural: [`${cap(fatigueWords(p.fatigue))}. Если будет возможность — смени нас.`],
      veteran: [`Ребята спят стоя. Смена нужна.`],
      timid: [`Нам нужна смена, капитан… пожалуйста.`],
    },
    askWithdraw: {
      executor: [`Капитан, прошу разрешения отойти на вторую линию.`],
      initiator: [`Капитан, разреши отойти на вторую — оттуда ударю во фланг.`],
      cautious: [`Капитан, разрешите отойти на вторую линию! Иначе потеряю людей!`],
      natural: [`Разреши отойти на вторую линию. Там удобнее.`],
      veteran: [`Отойду на вторую. Разрешаете?`],
      timid: [`Можно нам отойти?..`],
    },
    status: {
      executor: [`Докладываю обстановку. Личный состав — ${p.men}. ${cap(ammoWords(p.ammo, A))}. Противник: ${p.enemy}. Укрепления — ${p.fort}.`],
      initiator: [`Всё нормально, капитан. ${cap(ammoWords(p.ammo, A))}, ${fatigueWords(p.fatigue)}. Противник: ${p.enemy}.`],
      cautious: [`Капитан, обстановка напряжённая. ${cap(p.enemy)}. ${cap(ammoWords(p.ammo, A))}. ${cap(fatigueWords(p.fatigue))}.`],
      natural: [`Тихо пока. ${cap(p.enemy)}. ${cap(ammoWords(p.ammo, A))}. ${cap(moraleWords(p.morale))}.`],
      veteran: [`${cap(p.enemy)}. ${cap(ammoWords(p.ammo, A))}.`],
      timid: [`Пока держимся. ${cap(p.enemy)}…`],
    },
    raidAsk: {
      initiator: [`Капитан, у них пулемётная точка перед кладбищем, сидят беспечно. Разреши ночью сходить — десяток людей, вернусь с трофеями.`],
      natural: [`Капитан, есть мысль пощупать их ночью. Тихо, малой группой. Разрешаешь?`],
      veteran: [`Можно сходить к ним за «языком». Разрешите?`],
    },
    raidDone: {
      initiator: [`Сходили. Пулемёт их — наш, ${p.loot}. Потери — ${p.k}. Вот так, капитан.`],
      natural: [`Вернулись. ${cap(p.loot)}. Потеряли ${p.k}.`],
      veteran: [`Ходили. ${cap(p.loot)}. Потерь — ${p.k}.`],
    },
    raidFail: {
      initiator: [`Нарвались, капитан. Потерял ${p.k}. Моя вина.`],
      natural: [`Неудачно. Нас ждали. Потерял ${p.k}.`],
      veteran: [`Не вышло. ${p.k} не вернулись.`],
    },
    help: {
      initiator: [`Капитан, сосед горит — отправил ему отделение. Справимся без них.`],
      natural: [`Отправил отделение помочь соседу на ${p.to}. Так надо было.`],
      veteran: [`Послал троих соседу.`],
      executor: [`Докладываю: по просьбе соседа направил отделение на ${p.to}. Прошу утвердить.`],
    },
    counterOk: {
      executor: [`Контратака выполнена. Первая линия восстановлена.`],
      initiator: [`Вернули траншею! Я же говорил.`],
      cautious: [`Мы вернулись на первую линию… Потери есть.`],
      natural: [`Траншею вернули.`],
      veteran: [`Вернули.`],
      timid: [`Получилось… вернули.`],
    },
    counterFail: {
      executor: [`Контратака не удалась. Отошли на исходные. Потери — ${p.k}.`],
      initiator: [`Не прошли. Потерял ${p.k}. Ещё раз — и пройдём.`],
      cautious: [`Я говорил… не получилось. Потеряли ${p.k}.`],
      natural: [`Не вышло. ${p.k} потеряли.`],
      veteran: [`Не прошли. ${p.k} выбыли.`],
      timid: [`Не смогли…`],
    },
    selfWithdraw: {
      executor: [`Согласно приказу, при угрозе окружения — отошёл на вторую линию.`],
      initiator: [`Отвёл людей на вторую. Так было надо, капитан.`],
      cautious: [`Капитан, я отвёл людей на вторую линию. Иначе мы бы все там остались.`],
      natural: [`Отошёл на вторую по обстановке. Людей сохранил.`],
      veteran: [`Отошли на вторую.`],
      timid: [`Мы отошли. Простите.`],
    },
    selfCounter: {
      initiator: [`Капитан, они откатились — я пошёл за ними. Беру их окоп!`],
      natural: [`Они выдохлись. Иду вперёд, пока не опомнились.`],
    },
    arrived: {
      executor: [`Взвод прибыл. Принимаю участок.`],
      initiator: [`На месте. Где тут у вас противник?`],
      cautious: [`Прибыли. Осматриваемся.`],
      natural: [`На месте. Занял оборону.`],
      veteran: [`На месте.`],
      timid: [`Мы прибыли.`],
    },
  };
  const k = T[key];
  if (!k) return '…';
  const v = k[A] || k.executor || Object.values(k)[0];
  return pick(v);
}

/** Повтор приказа своими словами — главный способ проверить понимание. */
export function repeatOrder(o, order, garbled) {
  const what = orderText(order);
  if (garbled) {
    return pick([`…ял… ${garbled}… повторите, капитан, связь плохая!`, `Капитан, вас не слышно… понял: «${garbled}»… Так?`]);
  }
  const A = o.arch;
  if (A === 'executor') return `Есть ${what}. Повторяю: ${what}.`;
  if (A === 'initiator') return pick([`Понял — ${what}. Сделаем.`, `Ясно. ${cap(what)}. Уже.`]);
  if (A === 'cautious') return pick([`Понял, ${what}… Сделаю, что смогу.`, `Есть ${what}. Но, капитан, учтите — у меня мало людей.`]);
  if (A === 'natural') return pick([`Понял. ${cap(what)}. Детали — мои.`, `Добро. ${cap(what)}.`]);
  return `Понял. ${cap(what)}.`;
}

export function orderText(ord) {
  const S = ord.sector ? SECTORS[ord.sector] : null;
  let s = '';
  switch (ord.task) {
    case 'hold': s = 'удерживать позиции'; break;
    case 'withdraw': s = 'отойти на вторую линию'; break;
    case 'counter': s = 'контратаковать и вернуть позиции'; break;
    case 'reinforce': s = `выдвинуться на ${S.gen} сектор и усилить оборону`; break;
    case 'relieve': s = `сменить взвод в ${S.name.toLowerCase().replace('ый', 'ом').replace('ий', 'ем')} секторе`; break;
    case 'moveRes': s = `перейти ${ord.locName}`; break;
    case 'returnRes': s = 'вернуться в резерв'; break;
    case 'raid': s = 'ночью провести вылазку малой группой'; break;
    case 'report': s = 'доложить обстановку'; break;
    case 'come': s = 'явиться в штаб'; break;
    case 'saveAmmo': s = 'экономить боеприпасы'; break;
    default: s = ord.task;
  }
  if (ord.priority === 'hold' && (ord.task === 'hold' || ord.task === 'reinforce')) s += ' любой ценой';
  if (ord.priority === 'people' && (ord.task === 'hold' || ord.task === 'reinforce')) s += ', сберегая людей';
  if (ord.freedom === 'free') s += ', действуя по обстановке';
  if (ord.freedom === 'strict') s += ' — строго по приказу';
  return s;
}

export function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/** Искажает приказ при плохой связи: теряются слова. */
export function garble(text) {
  return text.split(' ').map((w) => (Math.random() < 0.4 ? '…' : w)).join(' ').replace(/(…\s*)+/g, '… ');
}
